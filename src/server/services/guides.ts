// Guide lifecycle: create, edit, review, approve, publish, revise, urgent correction, archive.
// Lifecycle: Draft -> In Review -> (Changes Requested) -> Ready for Approval -> Approved -> Published -> Under Review -> Superseded -> Archived
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client";
import { prisma, Tx } from "../db";
import { audit } from "../audit";
import { Ctx, hasRole } from "../ctx";
import { conflict, forbidden, notFound, unprocessable, badRequest } from "../errors";
import { canEditContent, canReadVersion, canSeeGuide, guideScope, isOwnerOrAdmin, assertReadVersion } from "../authz";
import { contentHash } from "../hash";
import { EDITABLE_STATUSES, LIVE_STATUSES, OPEN_STATUSES, CLASSIFICATIONS, type GuideStatus } from "../../lib/roles";
import { GuideContent, emptyContent, flattenSteps, guideContentSchema, isSafeUrl } from "../../lib/guide-schema";
import type { TemplateDef } from "../../lib/templates";
import { reindexGuide, removeFromIndex } from "./search";
import { blockingFindings } from "./health";
import { notify, usersWithRole } from "./notify";
import { emitEvent } from "./webhooks";

export interface WorkflowStage { name: string; role: "APPROVER" | "PROCESS_OWNER"; minApprovals: number }

export const metadataSchema = z.object({
  ownerId: z.string().nullable().optional(),
  backupOwnerId: z.string().nullable().optional(),
  escalationUserId: z.string().nullable().optional(),
  escalationPath: z.string().max(1000).optional(),
  reviewFrequencyDays: z.number().int().min(7).max(3650).optional(),
  siteId: z.string().nullable().optional(),
  businessUnit: z.string().max(200).nullable().optional(),
  department: z.string().max(200).nullable().optional(),
  processCode: z.string().max(100).nullable().optional(),
  functionCode: z.string().max(100).nullable().optional(),
  categories: z.array(z.string().max(100)).max(30).optional(),
  systems: z.array(z.string().max(100)).max(30).optional(),
  applications: z.array(z.string().max(100)).max(30).optional(),
  websites: z.array(z.string().max(200)).max(30).optional(),
  urlPatterns: z.array(z.string().max(300)).max(30).optional(),
  sapTransactions: z.array(z.string().max(30)).max(30).optional(),
  businessRoles: z.array(z.string().max(100)).max(30).optional(),
  classification: z.enum(CLASSIFICATIONS).optional(),
  criticality: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  workflowId: z.string().nullable().optional(),
});
export type GuideMetadata = z.infer<typeof metadataSchema>;

// ---------- loading ----------
export async function loadGuide(ctx: Ctx, idOrDoc: string, db: Tx | typeof prisma = prisma) {
  const g = await db.guide.findFirst({ where: { orgId: ctx.orgId, OR: [{ id: idOrDoc }, { documentId: idOrDoc }] } });
  if (!g || !canSeeGuide(ctx, g)) throw notFound("Guide");
  return g;
}

export async function loadVersion(ctx: Ctx, versionId: string, db: Tx | typeof prisma = prisma) {
  const v = await db.guideVersion.findFirst({ where: { id: versionId, orgId: ctx.orgId }, include: { guide: true } });
  if (!v) throw notFound("Version");
  assertReadVersion(ctx, v.guide, v.status as GuideStatus);
  return v;
}

async function workflowFor(orgId: string, workflowId: string | null, db: Tx | typeof prisma = prisma) {
  const wf = (workflowId && (await db.workflow.findFirst({ where: { id: workflowId, orgId } }))) || (await db.workflow.findFirst({ where: { orgId, isDefault: true } }));
  if (!wf) throw unprocessable("No approval route is configured for this guide");
  return { ...wf, stages: wf.stages as unknown as WorkflowStage[] };
}

async function nextDocumentId(tx: Tx, orgId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"docid:" + orgId}))`;
  const rows = await tx.guide.findMany({ where: { orgId }, select: { documentId: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.documentId.replace(/\D/g, "")) || 0), 0);
  return `WI-${String(max + 1).padStart(4, "0")}`;
}

function shortCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 7 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

const labelFor = (n: number) => `${n}.0`;

// ---------- create ----------
export async function createGuide(
  ctx: Ctx,
  input: { title: string; templateKey?: string; content?: GuideContent; metadata?: GuideMetadata; source?: "MANUAL" | "CAPTURE" | "IMPORT"; sourceRef?: string; importConfirmed?: boolean },
) {
  if (!hasRole(ctx, "AUTHOR")) throw forbidden("Only authors can create guides");
  const tpl = await prisma.template.findFirst({ where: { orgId: ctx.orgId, key: input.templateKey ?? "general", active: true } });
  if (!tpl) throw badRequest("Unknown template");
  const meta = metadataSchema.parse(input.metadata ?? {});
  await validateMetadataRefs(ctx, meta);
  const def = tpl.definition as unknown as TemplateDef;
  const content = guideContentSchema.parse({ ...emptyContent(tpl.key, input.title), ...def.defaults, ...(input.content ?? {}), title: input.title || input.content?.title || "", templateKey: tpl.key });
  await checkAssetRefs(ctx.orgId, content);
  return prisma.$transaction(async (tx) => {
    const documentId = await nextDocumentId(tx, ctx.orgId);
    let code = shortCode();
    while (await tx.guide.findUnique({ where: { shortCode: code } })) code = shortCode();
    const defWf = await tx.workflow.findFirst({ where: { orgId: ctx.orgId, isDefault: true } });
    const guide = await tx.guide.create({
      data: {
        orgId: ctx.orgId, documentId, shortCode: code, templateId: tpl.id, workflowId: meta.workflowId ?? defWf?.id ?? null, title: content.title,
        ownerId: meta.ownerId === undefined ? ctx.userId : meta.ownerId, backupOwnerId: meta.backupOwnerId ?? null, escalationUserId: meta.escalationUserId ?? null,
        escalationPath: meta.escalationPath ?? "", reviewFrequencyDays: meta.reviewFrequencyDays ?? 365, siteId: meta.siteId ?? ctx.siteId,
        businessUnit: meta.businessUnit ?? null, department: meta.department ?? null, processCode: meta.processCode ?? null, functionCode: meta.functionCode ?? null,
        categories: meta.categories ?? [], systems: meta.systems ?? [], applications: meta.applications ?? [], websites: meta.websites ?? [],
        urlPatterns: meta.urlPatterns ?? [], sapTransactions: meta.sapTransactions ?? [], businessRoles: meta.businessRoles ?? [],
        classification: meta.classification ?? "INTERNAL", criticality: meta.criticality ?? "MEDIUM", createdById: ctx.userId,
      },
    });
    const v = await tx.guideVersion.create({
      data: {
        guideId: guide.id, orgId: ctx.orgId, number: 1, label: labelFor(1), status: "DRAFT", content: content as object, contentHash: contentHash(content),
        authorId: ctx.userId, contributorIds: [ctx.userId], source: input.source ?? "MANUAL", sourceRef: input.sourceRef, importConfirmed: input.importConfirmed ?? true,
      },
    });
    await audit(ctx, null, { action: "GUIDE_CREATED", entityType: "Guide", entityId: guide.id, guideId: guide.id, versionId: v.id, summary: `Created ${documentId} "${content.title}" (${input.source ?? "MANUAL"})`, detail: { template: tpl.key, source: input.source ?? "MANUAL", sourceRef: input.sourceRef } }, tx);
    return { guide, version: v };
  });
}

async function validateMetadataRefs(ctx: Ctx, meta: GuideMetadata) {
  const ids = [meta.ownerId, meta.backupOwnerId, meta.escalationUserId].filter((x): x is string => !!x);
  if (ids.length) {
    const n = await prisma.user.count({ where: { id: { in: ids }, orgId: ctx.orgId, active: true } });
    if (n !== new Set(ids).size) throw badRequest("Owner, backup owner and escalation contact must be active users in your organisation");
  }
  if (meta.siteId) if (!(await prisma.site.findFirst({ where: { id: meta.siteId, orgId: ctx.orgId } }))) throw badRequest("Unknown site");
  if (meta.workflowId) if (!(await prisma.workflow.findFirst({ where: { id: meta.workflowId, orgId: ctx.orgId } }))) throw badRequest("Unknown workflow");
}

async function checkAssetRefs(orgId: string, content: GuideContent) {
  const ids = new Set<string>();
  for (const s of flattenSteps(content.steps)) {
    if (s.image) { ids.add(s.image.assetId); if (s.image.sourceAssetId) ids.add(s.image.sourceAssetId); }
    for (const l of s.links) if (!isSafeUrl(l.url)) throw unprocessable(`Unsafe link URL in step: ${l.label}`);
  }
  for (const a of content.attachments) ids.add(a.assetId);
  for (const r of content.related) if (r.url && !isSafeUrl(r.url)) throw unprocessable(`Unsafe URL for related item: ${r.title}`);
  if (!ids.size) return;
  const n = await prisma.asset.count({ where: { orgId, id: { in: [...ids] } } });
  if (n !== ids.size) throw unprocessable("Content references files that do not exist in this organisation");
}

// ---------- edit ----------
export async function saveContent(ctx: Ctx, versionId: string, content: unknown, expectedRev: number) {
  const v = await loadVersion(ctx, versionId);
  if (!canEditContent(ctx, v.guide)) throw forbidden("You cannot edit this guide");
  if (!EDITABLE_STATUSES.includes(v.status as GuideStatus)) throw conflict(`Version is ${v.status} and cannot be edited. Published versions are immutable; start a revision instead.`);
  const parsed = guideContentSchema.parse(content);
  await checkAssetRefs(ctx.orgId, parsed);
  const hash = contentHash(parsed);
  const updated = await prisma.$transaction(async (tx) => {
    // Optimistic concurrency: only succeeds when nobody saved since the client loaded.
    const r = await tx.guideVersion.updateMany({
      where: { id: versionId, rev: expectedRev, status: { in: EDITABLE_STATUSES } },
      data: { content: parsed as object, contentHash: hash, rev: { increment: 1 }, contributorIds: Array.from(new Set([...v.contributorIds, ctx.userId])) },
    });
    if (r.count === 0) throw conflict("This guide was changed by someone else. Reload to see the latest version.", { currentRev: (await tx.guideVersion.findUnique({ where: { id: versionId }, select: { rev: true } }))?.rev });
    if (!(await tx.guide.findFirst({ where: { id: v.guideId, liveVersionId: { not: null } } }))) await tx.guide.update({ where: { id: v.guideId }, data: { title: parsed.title } });
    // Coalesce autosave noise: one audit event per user per version per 10 minutes.
    const recent = await tx.auditEvent.findFirst({ where: { orgId: ctx.orgId, versionId, action: "CONTENT_SAVED", actorId: ctx.userId, at: { gt: new Date(Date.now() - 10 * 60_000) } } });
    if (!recent) await audit(ctx, null, { action: "CONTENT_SAVED", entityType: "GuideVersion", entityId: versionId, guideId: v.guideId, versionId, summary: `Edited ${v.guide.documentId} v${v.label}`, detail: { contentHash: hash } }, tx);
    return tx.guideVersion.findUniqueOrThrow({ where: { id: versionId } });
  });
  return { rev: updated.rev, contentHash: updated.contentHash, updatedAt: updated.updatedAt };
}

export async function updateMetadata(ctx: Ctx, guideId: string, patch: unknown) {
  const g = await loadGuide(ctx, guideId);
  const meta = metadataSchema.parse(patch);
  const controlled = Object.keys(meta).some((k) => ["ownerId", "backupOwnerId", "escalationUserId", "reviewFrequencyDays", "classification", "criticality", "workflowId", "siteId"].includes(k));
  if (controlled ? !isOwnerOrAdmin(ctx, g) && !(await isDraftAuthor(ctx, g.id)) : !(isOwnerOrAdmin(ctx, g) || canEditContent(ctx, g))) throw forbidden("You cannot change this metadata");
  await validateMetadataRefs(ctx, meta);
  const before: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(meta)) if (val !== undefined) { before[k] = (g as Record<string, unknown>)[k]; data[k] = val; }
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.guide.update({ where: { id: g.id }, data: { ...data, ...(meta.ownerId ? { orphanedSince: null } : {}) } });
    await audit(ctx, null, { action: "METADATA_UPDATED", entityType: "Guide", entityId: g.id, guideId: g.id, summary: `Updated metadata for ${g.documentId}: ${Object.keys(data).join(", ")}`, detail: { before, after: data } }, tx);
    if (g.liveVersionId) await reindexGuide(g.id, tx);
    return u;
  });
  return updated;
}

/** Authors may set governance metadata while the guide has no live version yet (initial set-up). */
async function isDraftAuthor(ctx: Ctx, guideId: string) {
  if (!hasRole(ctx, "AUTHOR")) return false;
  const g = await prisma.guide.findUnique({ where: { id: guideId }, select: { liveVersionId: true } });
  return !g?.liveVersionId;
}

// ---------- workflow ----------
function requireStatus(v: { status: string }, ...allowed: GuideStatus[]) {
  if (!allowed.includes(v.status as GuideStatus)) throw conflict(`Version is ${v.status}; this action requires ${allowed.join(" or ")}`);
}

export async function submitForReview(ctx: Ctx, versionId: string) {
  const v = await loadVersion(ctx, versionId);
  if (!canEditContent(ctx, v.guide) && !isOwnerOrAdmin(ctx, v.guide)) throw forbidden();
  requireStatus(v, "DRAFT", "CHANGES_REQUESTED");
  const blockers = await blockingFindings(ctx.orgId, versionId);
  if (blockers.length) throw unprocessable("Blocking issues must be resolved (or accepted as exceptions) before submission", blockers.map((b) => ({ ruleId: b.ruleId, message: b.message, stepId: b.stepId })));
  const wf = await workflowFor(ctx.orgId, v.guide.workflowId);
  const cycle = v.submissionCycle + 1;
  const skipReview = v.urgent; // urgent corrections go straight to approval, still audited
  await prisma.$transaction(async (tx) => {
    await tx.guideVersion.update({ where: { id: versionId }, data: { status: skipReview ? "READY_FOR_APPROVAL" : "IN_REVIEW", submissionCycle: cycle, submittedAt: new Date() } });
    await audit(ctx, null, { action: "SUBMITTED_FOR_REVIEW", entityType: "GuideVersion", entityId: versionId, guideId: v.guideId, versionId, summary: `${v.guide.documentId} v${v.label} submitted ${skipReview ? "for urgent approval" : "for review"}`, detail: { cycle, workflow: wf.key, urgent: v.urgent } }, tx);
    await notify(ctx.orgId, await usersWithRole(ctx.orgId, skipReview ? "APPROVER" : "REVIEWER", tx), "review_requested", `${v.guide.documentId} "${v.guide.title}" needs ${skipReview ? "urgent approval" : "review"}`, `/guides/${v.guideId}`, tx);
  });
  return { status: skipReview ? "READY_FOR_APPROVAL" : "IN_REVIEW", cycle };
}

function assertSegregation(ctx: Ctx, v: { authorId: string; contributorIds: string[] }, wf: { requireSegregation: boolean }, what: string) {
  if (wf.requireSegregation && (v.authorId === ctx.userId || v.contributorIds.includes(ctx.userId)))
    throw forbidden(`Segregation of duties: authors and contributors cannot ${what} their own guide`);
}

const decisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT", "REQUEST_CHANGES"]), comment: z.string().max(4000).default("") });

export async function reviewDecision(ctx: Ctx, versionId: string, input: unknown) {
  const { decision, comment } = decisionSchema.parse(input);
  const v = await loadVersion(ctx, versionId);
  if (!hasRole(ctx, "REVIEWER")) throw forbidden("Only reviewers can record review decisions");
  requireStatus(v, "IN_REVIEW");
  const wf = await workflowFor(ctx.orgId, v.guide.workflowId);
  assertSegregation(ctx, v, wf, "review");
  if (decision !== "APPROVE" && comment.trim().length < 3) throw unprocessable("A comment is required when requesting changes or rejecting");
  return prisma.$transaction(async (tx) => {
    const dup = await tx.approvalDecision.findFirst({ where: { versionId, cycle: v.submissionCycle, phase: "REVIEW", userId: ctx.userId } });
    if (dup) throw conflict("You have already recorded a review decision for this submission");
    await tx.approvalDecision.create({ data: { orgId: ctx.orgId, versionId, cycle: v.submissionCycle, phase: "REVIEW", stageName: "Review", userId: ctx.userId, userName: ctx.name, decision, comment } });
    let status: GuideStatus = "IN_REVIEW";
    if (decision !== "APPROVE") status = "CHANGES_REQUESTED";
    else {
      const approvals = await tx.approvalDecision.count({ where: { versionId, cycle: v.submissionCycle, phase: "REVIEW", decision: "APPROVE" } });
      if (approvals >= wf.reviewMin) status = "READY_FOR_APPROVAL";
    }
    if (status !== "IN_REVIEW") await tx.guideVersion.update({ where: { id: versionId }, data: { status } });
    await audit(ctx, null, { action: `REVIEW_${decision}`, entityType: "GuideVersion", entityId: versionId, guideId: v.guideId, versionId, summary: `${ctx.name} ${decision.toLowerCase().replace("_", " ")} review of ${v.guide.documentId} v${v.label}`, detail: { comment, resultingStatus: status } }, tx);
    if (status === "CHANGES_REQUESTED") await notify(ctx.orgId, [v.authorId, ...v.contributorIds], "changes_requested", `Changes requested on ${v.guide.documentId}: ${comment.slice(0, 120)}`, `/guides/${v.guideId}`, tx);
    if (status === "READY_FOR_APPROVAL") await notify(ctx.orgId, await usersWithRole(ctx.orgId, "APPROVER", tx), "approval_requested", `${v.guide.documentId} "${v.guide.title}" is ready for approval`, `/guides/${v.guideId}`, tx);
    return { status };
  });
}

export async function approvalDecision(ctx: Ctx, versionId: string, input: unknown) {
  const { decision, comment } = decisionSchema.parse(input);
  const v = await loadVersion(ctx, versionId);
  requireStatus(v, "READY_FOR_APPROVAL");
  const wf = await workflowFor(ctx.orgId, v.guide.workflowId);
  const stages: WorkflowStage[] = v.urgent ? [{ name: "Urgent correction approval", role: "APPROVER", minApprovals: 1 }] : wf.stages;
  assertSegregation(ctx, v, wf, "approve");
  if (decision !== "APPROVE" && comment.trim().length < 3) throw unprocessable("A comment is required when requesting changes or rejecting");
  return prisma.$transaction(async (tx) => {
    const done = await tx.approvalDecision.findMany({ where: { versionId, cycle: v.submissionCycle, phase: "APPROVAL", decision: "APPROVE" } });
    let idx = 0;
    for (; idx < stages.length; idx++) if (done.filter((d) => d.stageIndex === idx).length < stages[idx].minApprovals) break;
    if (idx >= stages.length) throw conflict("All approval stages are already satisfied");
    const stage = stages[idx];
    const isOwner = v.guide.ownerId === ctx.userId || v.guide.backupOwnerId === ctx.userId;
    if (stage.role === "APPROVER" && !hasRole(ctx, "APPROVER")) throw forbidden(`Stage "${stage.name}" requires the Approver role`);
    if (stage.role === "PROCESS_OWNER" && !(hasRole(ctx, "PROCESS_OWNER") && isOwner)) throw forbidden(`Stage "${stage.name}" must be approved by the guide's process owner or backup owner`);
    if (done.some((d) => d.userId === ctx.userId)) throw conflict("You have already approved an earlier stage of this submission");
    await tx.approvalDecision.create({ data: { orgId: ctx.orgId, versionId, cycle: v.submissionCycle, phase: "APPROVAL", stageIndex: idx, stageName: stage.name, userId: ctx.userId, userName: ctx.name, decision, comment } });
    let status: GuideStatus = "READY_FOR_APPROVAL";
    if (decision !== "APPROVE") status = "CHANGES_REQUESTED";
    else {
      const total = done.length + 1;
      const need = stages.reduce((a, s) => a + s.minApprovals, 0);
      if (total >= need) status = "APPROVED";
    }
    if (status !== "READY_FOR_APPROVAL") await tx.guideVersion.update({ where: { id: versionId }, data: { status, ...(status === "APPROVED" ? { approvedAt: new Date() } : {}) } });
    await audit(ctx, null, { action: `APPROVAL_${decision}`, entityType: "GuideVersion", entityId: versionId, guideId: v.guideId, versionId, summary: `${ctx.name} ${decision.toLowerCase().replace("_", " ")} at stage "${stage.name}" for ${v.guide.documentId} v${v.label}`, detail: { comment, stage: stage.name, stageIndex: idx, resultingStatus: status } }, tx);
    if (status === "APPROVED") await notify(ctx.orgId, await usersWithRole(ctx.orgId, "PUBLISHER", tx), "ready_to_publish", `${v.guide.documentId} "${v.guide.title}" is approved and ready to publish`, `/guides/${v.guideId}`, tx);
    if (status === "CHANGES_REQUESTED") await notify(ctx.orgId, [v.authorId, ...v.contributorIds], "changes_requested", `Changes requested on ${v.guide.documentId}: ${comment.slice(0, 120)}`, `/guides/${v.guideId}`, tx);
    return { status, stage: stage.name };
  });
}

export async function publishVersion(ctx: Ctx, versionId: string, opts: { effectiveDate?: string } = {}) {
  if (!hasRole(ctx, "PUBLISHER")) throw forbidden("Only publishers / document controllers can publish");
  const v = await loadVersion(ctx, versionId);
  requireStatus(v, "APPROVED");
  const wf = await workflowFor(ctx.orgId, v.guide.workflowId);
  if (wf.requireSegregation && v.authorId === ctx.userId) throw forbidden("Segregation of duties: the author cannot publish their own guide");
  const blockers = await blockingFindings(ctx.orgId, versionId);
  if (blockers.length) throw unprocessable("Blocking issues remain; the guide cannot be published", blockers.map((b) => ({ ruleId: b.ruleId, message: b.message })));
  const now = new Date();
  const effective = opts.effectiveDate ? new Date(opts.effectiveDate) : now;
  if (isNaN(effective.getTime())) throw badRequest("Invalid effective date");
  const reviewDate = new Date(effective.getTime() + v.guide.reviewFrequencyDays * 86400_000);
  const result = await prisma.$transaction(async (tx) => {
    const decisions = await tx.approvalDecision.findMany({ where: { versionId, decision: "APPROVE" }, orderBy: { decidedAt: "asc" } });
    const cycleDecisions = decisions.filter((d) => d.cycle === v.submissionCycle);
    const [owner, backup, site] = await Promise.all([
      v.guide.ownerId ? tx.user.findUnique({ where: { id: v.guide.ownerId }, select: { name: true } }) : null,
      v.guide.backupOwnerId ? tx.user.findUnique({ where: { id: v.guide.backupOwnerId }, select: { name: true } }) : null,
      v.guide.siteId ? tx.site.findUnique({ where: { id: v.guide.siteId } }) : null,
    ]);
    const author = await tx.user.findUnique({ where: { id: v.authorId }, select: { name: true } });
    const snapshot = {
      documentId: v.guide.documentId, title: (v.content as { title: string }).title, versionNumber: v.number, versionLabel: v.label,
      publishedAt: now.toISOString(), effectiveDate: effective.toISOString(), reviewDate: reviewDate.toISOString(),
      owner: owner?.name ?? null, backupOwner: backup?.name ?? null, author: author?.name ?? null, site: site?.name ?? null,
      businessUnit: v.guide.businessUnit, department: v.guide.department, classification: v.guide.classification, criticality: v.guide.criticality,
      systems: v.guide.systems, applications: v.guide.applications, sapTransactions: v.guide.sapTransactions, websites: v.guide.websites,
      reviewFrequencyDays: v.guide.reviewFrequencyDays, revisionSummary: v.revisionSummary, urgent: v.urgent, urgentReason: v.urgentReason,
      approvals: cycleDecisions.map((d) => ({ stage: d.stageName, phase: d.phase, by: d.userName, at: d.decidedAt.toISOString(), comment: d.comment })),
    };
    if (v.guide.liveVersionId) {
      await tx.guideVersion.update({ where: { id: v.guide.liveVersionId }, data: { status: "SUPERSEDED", supersededAt: now, supersededByNumber: v.number } });
    }
    const pub = await tx.guideVersion.update({ where: { id: versionId }, data: { status: "PUBLISHED", publishedAt: now, publishedById: ctx.userId, effectiveDate: effective, reviewDate, controlSnapshot: snapshot } });
    await tx.guide.update({ where: { id: v.guideId }, data: { liveVersionId: versionId, title: snapshot.title } });
    await reindexGuide(v.guideId, tx);
    if (v.urgent) {
      await tx.reviewRecommendation.create({ data: { orgId: ctx.orgId, guideId: v.guideId, versionId, source: "URGENT_FOLLOWUP", dedupeKey: `URGENT_FOLLOWUP:${versionId}`, reasons: [{ ruleId: "urgent.correction", message: "Published via urgent correction", explanation: `Reason: ${v.urgentReason}. A full standard review is required.` }] } });
    }
    await audit(ctx, null, { action: "PUBLISHED", entityType: "GuideVersion", entityId: versionId, guideId: v.guideId, versionId, summary: `Published ${v.guide.documentId} v${v.label}${v.guide.liveVersionId ? " (superseding previous version)" : ""}`, detail: { supersededVersionId: v.guide.liveVersionId, contentHash: v.contentHash, effectiveDate: effective, reviewDate } }, tx);
    await notify(ctx.orgId, [v.guide.ownerId, v.guide.backupOwnerId, v.authorId], "published", `${v.guide.documentId} "${snapshot.title}" v${v.label} is now published`, `/g/${v.guide.documentId}`, tx);
    return pub;
  });
  await emitEvent(ctx.orgId, "guide.published", { documentId: v.guide.documentId, version: v.label, versionId, title: (v.content as { title: string }).title, url: `/g/${v.guide.documentId}`, supersedes: v.guide.liveVersionId });
  return { status: result.status, publishedAt: result.publishedAt, reviewDate: result.reviewDate };
}

// ---------- revisions ----------
async function assertNoOpenVersion(guideId: string) {
  const open = await prisma.guideVersion.findFirst({ where: { guideId, status: { in: OPEN_STATUSES } } });
  if (open) throw conflict(`Version ${open.label} is already in progress (${open.status}).`, { versionId: open.id });
}

export async function startRevision(ctx: Ctx, guideId: string, input: { summary: string; urgent?: { reason: string; authorId?: string } }) {
  const g = await loadGuide(ctx, guideId);
  if (input.urgent) {
    if (!hasRole(ctx, "PUBLISHER", "ADMIN")) throw forbidden("Urgent corrections must be initiated by a publisher or administrator");
    if (input.urgent.reason.trim().length < 10) throw unprocessable("An urgent correction requires a reason (min 10 characters)");
  } else if (!(canEditContent(ctx, g) || isOwnerOrAdmin(ctx, g))) throw forbidden("You cannot revise this guide");
  if (!g.liveVersionId) throw conflict("Only a published guide can be revised; edit the existing draft instead");
  await assertNoOpenVersion(g.id);
  const live = await prisma.guideVersion.findUniqueOrThrow({ where: { id: g.liveVersionId } });
  const last = await prisma.guideVersion.findFirst({ where: { guideId: g.id }, orderBy: { number: "desc" } });
  const n = (last?.number ?? 0) + 1;
  // Urgent corrections are initiated by a publisher/admin but authored by an Author, so segregation of duties still holds.
  let authorId = ctx.userId;
  if (input.urgent) {
    authorId = input.urgent.authorId ?? live.authorId;
    const a = await prisma.user.findFirst({ where: { id: authorId, orgId: ctx.orgId, active: true, roles: { has: "AUTHOR" } } });
    if (!a) throw unprocessable("An active author must be assigned to draft the urgent correction");
    if (authorId === ctx.userId) throw unprocessable("The initiator of an urgent correction cannot also be its author");
  }
  if (!input.urgent && input.summary.trim().length < 3) throw unprocessable("Describe what you intend to change (revision summary)");
  return prisma.$transaction(async (tx) => {
    const nv = await tx.guideVersion.create({
      data: {
        guideId: g.id, orgId: ctx.orgId, number: n, label: labelFor(n), status: "DRAFT", content: live.content as object, contentHash: live.contentHash,
        authorId, contributorIds: [authorId], source: input.urgent ? "URGENT_CORRECTION" : "REVISION", sourceRef: live.id,
        revisionSummary: input.summary, urgent: !!input.urgent, urgentReason: input.urgent?.reason ?? null,
      },
    });
    await audit(ctx, null, { action: input.urgent ? "URGENT_CORRECTION_STARTED" : "REVISION_STARTED", entityType: "GuideVersion", entityId: nv.id, guideId: g.id, versionId: nv.id, summary: `${input.urgent ? "Urgent correction" : "Revision"} v${nv.label} of ${g.documentId} started from v${live.label}`, detail: { basedOn: live.id, summary: input.summary, urgentReason: input.urgent?.reason, initiatedBy: ctx.userId, assignedAuthor: authorId } }, tx);
    return nv;
  });
}

/** Owner marks the live guide as under periodic review (still live; readers see a banner). */
export async function markUnderReview(ctx: Ctx, guideId: string, reason: string) {
  const g = await loadGuide(ctx, guideId);
  if (!isOwnerOrAdmin(ctx, g) && !hasRole(ctx, "PUBLISHER")) throw forbidden();
  if (!g.liveVersionId) throw conflict("Guide is not published");
  const v = await prisma.guideVersion.findUniqueOrThrow({ where: { id: g.liveVersionId } });
  requireStatus(v, "PUBLISHED");
  await prisma.$transaction(async (tx) => {
    await tx.guideVersion.update({ where: { id: v.id }, data: { status: "UNDER_REVIEW" } });
    await audit(ctx, null, { action: "UNDER_REVIEW", entityType: "GuideVersion", entityId: v.id, guideId: g.id, versionId: v.id, summary: `${g.documentId} marked under review`, detail: { reason } }, tx);
  });
}

/** Owner completes a periodic review without changes: back to Published with a new review date. */
export async function completeReviewNoChange(ctx: Ctx, guideId: string, note: string) {
  const g = await loadGuide(ctx, guideId);
  if (!isOwnerOrAdmin(ctx, g)) throw forbidden("Only the owner, backup owner or an administrator can confirm a review");
  if (!g.liveVersionId) throw conflict("Guide is not published");
  const v = await prisma.guideVersion.findUniqueOrThrow({ where: { id: g.liveVersionId } });
  requireStatus(v, "UNDER_REVIEW", "PUBLISHED");
  if (note.trim().length < 5) throw unprocessable("A review note is required");
  const reviewDate = new Date(Date.now() + g.reviewFrequencyDays * 86400_000);
  await prisma.$transaction(async (tx) => {
    await tx.guideVersion.update({ where: { id: v.id }, data: { status: "PUBLISHED", reviewDate } });
    await audit(ctx, null, { action: "REVIEW_COMPLETED_NO_CHANGE", entityType: "GuideVersion", entityId: v.id, guideId: g.id, versionId: v.id, summary: `${g.documentId} review completed with no change; next review ${reviewDate.toISOString().slice(0, 10)}`, detail: { note, previousReviewDate: v.reviewDate } }, tx);
    await reindexGuide(g.id, tx);
  });
  return { reviewDate };
}

export async function archiveGuide(ctx: Ctx, guideId: string, reason: string) {
  const g = await loadGuide(ctx, guideId);
  if (!hasRole(ctx, "PUBLISHER", "ADMIN")) throw forbidden("Only publishers or administrators can archive/withdraw");
  if (g.legalHold) throw conflict("Guide is under legal hold");
  if (reason.trim().length < 5) throw unprocessable("A reason is required");
  await prisma.$transaction(async (tx) => {
    if (g.liveVersionId) await tx.guideVersion.update({ where: { id: g.liveVersionId }, data: { status: "ARCHIVED" } });
    await tx.guide.update({ where: { id: g.id }, data: { archivedAt: new Date(), liveVersionId: null } });
    await removeFromIndex(g.id, tx);
    await audit(ctx, null, { action: "ARCHIVED", entityType: "Guide", entityId: g.id, guideId: g.id, summary: `${g.documentId} archived`, detail: { reason } }, tx);
  });
  await emitEvent(ctx.orgId, "guide.archived", { documentId: g.documentId });
}

export async function discardDraft(ctx: Ctx, versionId: string) {
  const v = await loadVersion(ctx, versionId);
  if (!canEditContent(ctx, v.guide)) throw forbidden();
  requireStatus(v, "DRAFT");
  await prisma.$transaction(async (tx) => {
    const others = await tx.guideVersion.count({ where: { guideId: v.guideId, id: { not: v.id } } });
    await audit(ctx, null, { action: "DRAFT_DISCARDED", entityType: "GuideVersion", entityId: v.id, guideId: v.guideId, versionId: v.id, summary: `Discarded draft ${v.guide.documentId} v${v.label}` }, tx);
    await tx.guideVersion.delete({ where: { id: v.id } });
    if (others === 0) await tx.guide.delete({ where: { id: v.guideId } });
  });
}

// ---------- reading ----------
export async function getVersionDetail(ctx: Ctx, versionId: string) {
  const v = await loadVersion(ctx, versionId);
  const decisions = await prisma.approvalDecision.findMany({ where: { versionId }, orderBy: { decidedAt: "asc" } });
  return { ...v, content: guideContentSchema.parse(v.content), decisions, canEdit: canEditContent(ctx, v.guide) && EDITABLE_STATUSES.includes(v.status as GuideStatus) };
}

export async function listVersions(ctx: Ctx, guideId: string) {
  const g = await loadGuide(ctx, guideId);
  const vs = await prisma.guideVersion.findMany({ where: { guideId: g.id }, orderBy: { number: "desc" } });
  return vs.filter((v) => canReadVersion(ctx, g, v.status as GuideStatus)).map((v) => ({
    id: v.id, number: v.number, label: v.label, status: v.status, source: v.source, revisionSummary: v.revisionSummary, urgent: v.urgent,
    publishedAt: v.publishedAt, reviewDate: v.reviewDate, createdAt: v.createdAt, contentHash: v.contentHash,
  }));
}

/** Guides the caller is working on (workspace) - includes drafts; never used for learner search. */
export async function listWorkspace(ctx: Ctx) {
  if (!hasRole(ctx, "AUTHOR", "PROCESS_OWNER", "REVIEWER", "APPROVER", "PUBLISHER", "ADMIN", "AUDITOR")) throw forbidden();
  return prisma.guideVersion.findMany({
    where: { orgId: ctx.orgId, status: { in: OPEN_STATUSES }, guide: guideScope(ctx) },
    include: { guide: { select: { id: true, documentId: true, title: true, ownerId: true, liveVersionId: true } } },
    orderBy: { updatedAt: "desc" }, take: 200,
  });
}

export async function getLiveByDocumentId(ctx: Ctx, documentId: string) {
  const g = await prisma.guide.findFirst({ where: { orgId: ctx.orgId, OR: [{ documentId }, { shortCode: documentId }] } });
  if (!g || !canSeeGuide(ctx, g) || g.archivedAt) return null;
  if (!g.liveVersionId) return { guide: g, version: null };
  const v = await prisma.guideVersion.findUniqueOrThrow({ where: { id: g.liveVersionId } });
  return { guide: g, version: { ...v, content: guideContentSchema.parse(v.content) } };
}

export type { Prisma };
export { LIVE_STATUSES };
