import { createHash } from "node:crypto";
import { prisma, Db } from "./db";
import type { Ctx } from "./ctx";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  guideId?: string | null;
  versionId?: string | null;
  summary: string;
  detail?: Record<string, unknown>;
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}

export function auditHash(prevHash: string, e: {
  orgId: string; seq: bigint; at: Date; actorId: string | null; action: string; entityType: string; entityId: string; summary: string; detail: unknown;
}) {
  // Normalise through JSON so the hash is stable across the JSONB round trip (undefined dropped, Dates -> ISO strings).
  const detail = JSON.parse(JSON.stringify(e.detail ?? {}));
  return createHash("sha256")
    .update(prevHash + "|" + canonical({ ...e, detail, seq: e.seq.toString(), at: e.at.toISOString() }))
    .digest("hex");
}

/**
 * Append an audit event. Events form a per-organisation hash chain (tamper evidence) and the table is
 * append-only at database level. An advisory lock serialises writers per organisation.
 * Must be called inside the same transaction as the change it records where possible.
 */
export async function audit(ctx: Pick<Ctx, "orgId" | "userId" | "name" | "ip" | "requestId"> | null, orgIdFallback: string | null, input: AuditInput, db?: Db) {
  const orgId = ctx?.orgId ?? orgIdFallback!;
  const write = async (tx: Db) => {
    await (tx as typeof prisma).$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"audit:" + orgId}))`;
    const last = await tx.auditEvent.findFirst({ where: { orgId }, orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
    const seq = (last?.seq ?? BigInt(0)) + BigInt(1);
    const prevHash = last?.hash ?? "GENESIS";
    const at = new Date();
    const actorId = ctx && ctx.userId !== "system" ? ctx.userId : null;
    const detail = (input.detail ?? {}) as object;
    const hash = auditHash(prevHash, { orgId, seq, at, actorId, action: input.action, entityType: input.entityType, entityId: input.entityId, summary: input.summary, detail });
    await tx.auditEvent.create({
      data: {
        orgId, seq, at, actorId, actorLabel: ctx?.name ?? "system", action: input.action, entityType: input.entityType,
        entityId: input.entityId, guideId: input.guideId ?? null, versionId: input.versionId ?? null, summary: input.summary,
        detail, ip: ctx?.ip ?? null, requestId: ctx?.requestId ?? null, prevHash, hash,
      },
    });
  };
  // Inside a caller's transaction (no $transaction on tx clients): join it. Otherwise open our own so the lock holds.
  if (db && !("$transaction" in db)) return write(db);
  return prisma.$transaction(async (tx) => write(tx));
}

/** Verify the audit hash chain for an organisation. Returns first broken sequence number, if any. */
export async function verifyAuditChain(orgId: string): Promise<{ ok: boolean; checked: number; brokenAtSeq?: string }> {
  const events = await prisma.auditEvent.findMany({ where: { orgId }, orderBy: { seq: "asc" } });
  let prev = "GENESIS";
  for (const e of events) {
    const expected = auditHash(prev, {
      orgId, seq: e.seq, at: e.at, actorId: e.actorId, action: e.action, entityType: e.entityType, entityId: e.entityId, summary: e.summary, detail: e.detail,
    });
    if (e.prevHash !== prev || e.hash !== expected) return { ok: false, checked: events.length, brokenAtSeq: e.seq.toString() };
    prev = e.hash;
  }
  return { ok: true, checked: events.length };
}
