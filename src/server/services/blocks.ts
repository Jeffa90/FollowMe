// Reusable governed content blocks (standard warnings, safety controls, privacy notices...). A block is embedded in a guide as a
// snapshot (blockId + version + text) so published guides stay immutable. Changing a block never rewrites approved guides:
// it shows the affected guides first, then files review recommendations so owners can re-approve where appropriate.
import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { hasRole } from "../ctx";
import { forbidden, notFound, conflict } from "../errors";
import { guideContentSchema, flattenSteps } from "../../lib/guide-schema";
import { notify } from "./notify";
import { OPEN_STATUSES, LIVE_STATUSES } from "../../lib/roles";
import { guideScope } from "../authz";

const KINDS = ["WARNING", "SAFETY", "PRIVACY", "PREREQUISITE", "APPROVAL", "DEFINITION", "ESCALATION"] as const;
const blockSchema = z.object({ key: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/), kind: z.enum(KINDS), title: z.string().min(2).max(200), body: z.string().min(2).max(4000), requiresReapproval: z.boolean().default(true) });

const canManage = (ctx: Ctx) => hasRole(ctx, "AUTHOR", "PROCESS_OWNER", "ADMIN");

export async function listBlocks(ctx: Ctx) {
  return prisma.contentBlock.findMany({ where: { orgId: ctx.orgId }, orderBy: { title: "asc" } });
}

export async function createBlock(ctx: Ctx, input: unknown) {
  if (!canManage(ctx)) throw forbidden();
  const b = blockSchema.parse(input);
  if (await prisma.contentBlock.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: b.key } } })) throw conflict("A block with that key exists");
  const row = await prisma.contentBlock.create({ data: { orgId: ctx.orgId, ...b } });
  await prisma.contentBlockVersion.create({ data: { blockId: row.id, version: 1, title: b.title, body: b.body, changedById: ctx.userId } });
  await audit(ctx, null, { action: "BLOCK_CREATED", entityType: "ContentBlock", entityId: row.id, summary: `Created reusable block "${b.title}"` });
  return row;
}

/** All guide versions (live or in progress) that embed this block, with whether they use the latest block version. */
export async function blockImpact(ctx: Ctx, blockId: string) {
  const block = await prisma.contentBlock.findFirst({ where: { id: blockId, orgId: ctx.orgId } });
  if (!block) throw notFound("Block");
  const versions = await prisma.guideVersion.findMany({ where: { orgId: ctx.orgId, status: { in: [...OPEN_STATUSES, ...LIVE_STATUSES] }, guide: guideScope(ctx) }, include: { guide: { select: { id: true, documentId: true, title: true, ownerId: true, backupOwnerId: true } } } });
  const affected = [];
  for (const v of versions) {
    const uses = flattenSteps(guideContentSchema.parse(v.content).steps).filter((s) => s.blockRef?.blockId === blockId);
    if (uses.length) affected.push({ guideId: v.guide.id, documentId: v.guide.documentId, title: v.guide.title, versionId: v.id, versionLabel: v.label, status: v.status, usesVersion: uses[0].blockRef!.version, upToDate: uses[0].blockRef!.version === block.version, owner: v.guide.ownerId, backup: v.guide.backupOwnerId });
  }
  return { block, affected };
}

export async function reviseBlock(ctx: Ctx, blockId: string, input: unknown) {
  if (!canManage(ctx)) throw forbidden();
  const { title, body, requiresReapproval, acknowledgeImpactCount } = z.object({ title: z.string().min(2).max(200), body: z.string().min(2).max(4000), requiresReapproval: z.boolean().optional(), acknowledgeImpactCount: z.number().int().min(0) }).parse(input);
  const { block, affected } = await blockImpact(ctx, blockId);
  // The caller must have seen the current impact list before changing the block.
  if (acknowledgeImpactCount !== affected.length) throw conflict(`Impact changed: ${affected.length} version(s) currently use this block. Review the list and confirm again.`, { affected: affected.length });
  const version = block.version + 1;
  const reapprove = requiresReapproval ?? block.requiresReapproval;
  await prisma.$transaction(async (tx) => {
    await tx.contentBlock.update({ where: { id: blockId }, data: { title, body, version, requiresReapproval: reapprove } });
    await tx.contentBlockVersion.create({ data: { blockId, version, title, body, changedById: ctx.userId } });
    for (const a of affected.filter((x) => LIVE_STATUSES.includes(x.status as never))) {
      const dedupeKey = `BLOCK_CHANGE:${blockId}:${version}:${a.guideId}`;
      await tx.reviewRecommendation.create({ data: { orgId: ctx.orgId, guideId: a.guideId, versionId: a.versionId, source: "BLOCK_CHANGE", dedupeKey, reasons: [{ ruleId: "block.changed", message: `Reusable block "${title}" changed (v${a.usesVersion} -> v${version}).${reapprove ? " Re-approval is required for this change." : ""}`, explanation: "The published guide still shows the approved older wording until it is revised and re-approved." }] } });
      await notify(ctx.orgId, [a.owner, a.backup], "block_changed", `Reusable block "${title}" changed: ${a.documentId} needs review`, `/guides/${a.guideId}`, tx);
    }
    for (const a of affected.filter((x) => OPEN_STATUSES.includes(x.status as never))) {
      const g = await tx.guideVersion.findUnique({ where: { id: a.versionId }, select: { authorId: true } });
      await notify(ctx.orgId, [g?.authorId], "block_changed", `Reusable block "${title}" changed: update the block in draft ${a.documentId}`, `/guides/${a.guideId}/edit?v=${a.versionId}`, tx);
    }
    await audit(ctx, null, { action: "BLOCK_REVISED", entityType: "ContentBlock", entityId: blockId, summary: `Block "${title}" revised to v${version}; ${affected.length} version(s) affected`, detail: { affected: affected.map((a) => a.documentId), requiresReapproval: reapprove } }, tx);
  });
  return { version, affected: affected.length };
}
