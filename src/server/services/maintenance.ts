// Background maintenance: health scans (review recommendations, orphaned guides, duplicates) and retention sweeps.
import { prisma } from "../db";
import { audit } from "../audit";
import { enqueue, registerJob } from "../jobs";
import { runOrgHealthScan } from "./health";
import { blobStore } from "../storage";
import { retentionPolicySchema } from "../../lib/policy";

registerJob("health.scan", async ({ orgId }: { orgId: string }) => runOrgHealthScan(orgId));
registerJob("retention.sweep", async ({ orgId }: { orgId: string }) => retentionSweep(orgId));

/** Delete an asset row and its blob, unless another asset row still references the same (content-addressed) blob. */
async function purgeAsset(assetId: string) {
  const a = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!a) return;
  await prisma.asset.delete({ where: { id: assetId } });
  const others = await prisma.asset.count({ where: { storageKey: a.storageKey } });
  if (others === 0) await blobStore().delete(a.storageKey).catch(() => undefined);
}

/**
 * Retention: analytics logs and abandoned/discarded raw capture evidence expire per policy. Legal hold (organisation or guide)
 * suspends deletion. Imported SOURCE documents and published content are never touched by retention.
 */
export async function retentionSweep(orgId: string, now = new Date()) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (org.legalHold) return { skipped: "legal-hold" as const };
  const p = retentionPolicySchema.parse(org.retentionPolicy ?? {});
  const day = 86400_000;
  const res = { searchLogs: 0, viewEvents: 0, captureSessions: 0, assets: 0 };
  res.searchLogs = (await prisma.searchLog.deleteMany({ where: { orgId, at: { lt: new Date(now.getTime() - p.searchLogDays * day) } } })).count;
  res.viewEvents = (await prisma.viewEvent.deleteMany({ where: { orgId, at: { lt: new Date(now.getTime() - p.viewEventDays * day) } } })).count;
  const stale = await prisma.captureSession.findMany({
    where: { orgId, guideId: null, OR: [{ status: "DISCARDED", endedAt: { lt: new Date(now.getTime() - p.discardedCaptureDays * day) } }, { status: { in: ["STOPPED", "PAUSED", "RECORDING"] }, startedAt: { lt: new Date(now.getTime() - p.staleUnprocessedCaptureDays * day) } }] },
  });
  for (const s of stale) {
    const assets = await prisma.asset.findMany({ where: { captureSessionId: s.id, purpose: "EVIDENCE" }, select: { id: true } });
    for (const a of assets) { await purgeAsset(a.id); res.assets++; }
    await prisma.captureSession.delete({ where: { id: s.id } }); // events cascade
    res.captureSessions++;
  }
  await audit(null, orgId, { action: "RETENTION_SWEEP", entityType: "Organization", entityId: orgId, summary: `Retention sweep removed ${res.searchLogs} search logs, ${res.viewEvents} view events, ${res.captureSessions} stale captures`, detail: res });
  return res;
}

/** Called periodically by the worker: enqueue at most one pending scan per organisation per interval. */
export async function scheduleMaintenance(now = new Date()) {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  for (const o of orgs) {
    for (const [type, everyMs] of [["health.scan", 3600_000], ["retention.sweep", 86400_000]] as const) {
      const recent = await prisma.job.findFirst({ where: { type, orgId: o.id, OR: [{ status: { in: ["QUEUED", "RUNNING"] } }, { createdAt: { gt: new Date(now.getTime() - everyMs) } }] } });
      if (!recent) await enqueue(type, { orgId: o.id }, { orgId: o.id });
    }
  }
}
