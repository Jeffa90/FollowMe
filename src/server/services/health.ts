// Explainable content-health rules. Findings are advice: this module NEVER edits, withdraws or republishes approved content.
// Its only writes are HealthFinding rows, ReviewRecommendation rows and notifications.
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { guideContentSchema, flattenSteps, isSafeUrl, stepPlainText, type GuideContent } from "../../lib/guide-schema";
import { similarity } from "../../lib/compare";
import type { TemplateDef } from "../../lib/templates";
import { LIVE_STATUSES, OPEN_STATUSES, type GuideStatus } from "../../lib/roles";
import { notify, usersWithRole } from "./notify";
import { forbidden, notFound } from "../errors";
import { hasRole } from "../ctx";
import { canSeeGuide } from "../authz";

export const NO_STEP = "";
type Severity = "BLOCKING_ERROR" | "WARNING" | "SUGGESTION";
export interface Candidate {
  ruleId: string; severity: Severity; stepId?: string; message: string; explanation: string; evidence?: Record<string, unknown>;
}

const COMMON_ACRONYMS = new Set(["OK", "ID", "PDF", "URL", "HTTP", "HTTPS", "HTML", "IT", "HR", "UK", "US", "EU", "PC", "USB", "FAQ", "AM", "PM", "UI", "QR", "CSV", "XML", "API", "VAT", "PPE"]);

export interface HealthInput {
  guide: {
    id: string; documentId: string; ownerId: string | null; backupOwnerId: string | null; escalationUserId: string | null; escalationPath: string;
    reviewFrequencyDays: number; workflowId: string | null; systems: string[]; applications: string[]; sapTransactions: string[];
    siteId: string | null; processCode: string | null;
  };
  version: { id: string; number: number; status: GuideStatus; reviewDate: Date | null; revisionSummary: string; importConfirmed: boolean };
  content: GuideContent;
  template: TemplateDef;
  ownerActive: boolean;
  backupActive: boolean;
  hasWorkflow: boolean;
  retired: { kind: string; value: string; replacement: string | null; note: string }[];
  knownAcronyms: Set<string>;
  existingAssetIds: Set<string>;
  liveRelatedDocIds: Set<string>;
  feedback: { outdatedOpen: number; ratingCount: number; ratingAvg: number | null };
  now: Date;
}

const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim().length > 0 : !!v);

export function evaluate(i: HealthInput): Candidate[] {
  const out: Candidate[] = [];
  const c = i.content;
  const g = i.guide;
  const open = OPEN_STATUSES.includes(i.version.status);
  const live = LIVE_STATUSES.includes(i.version.status);
  const steps = flattenSteps(c.steps);

  if (!c.title.trim()) out.push({ ruleId: "content.title_missing", severity: "BLOCKING_ERROR", message: "The guide has no title.", explanation: "Every guide needs a title so it can be found and cited." });
  if (steps.filter((s) => s.kind === "action" || s.kind === "physical" || s.kind === "decision").length === 0)
    out.push({ ruleId: "content.no_steps", severity: "BLOCKING_ERROR", message: "The guide has no procedure steps.", explanation: "A work instruction must contain at least one action, physical step or decision." });

  for (const sec of i.template.sections) {
    if (!sec.enabled) continue;
    const val = (c as Record<string, unknown>)[sec.key];
    if (!has(val)) {
      if (sec.required) out.push({ ruleId: `template.required.${sec.key}`, severity: "BLOCKING_ERROR", message: `Required section "${sec.label}" is empty.`, explanation: `The selected template requires "${sec.label}". Complete it or choose a different template.` });
      else if (["purpose", "scope", "prerequisites", "expectedResult"].includes(sec.key))
        out.push({ ruleId: `content.section_missing.${sec.key}`, severity: "SUGGESTION", message: `"${sec.label}" is empty.`, explanation: `Readers benefit from a stated ${sec.label.toLowerCase()}. Add one, or ignore if it does not apply.` });
    }
  }
  for (const m of i.template.requiredMeta) {
    const v = (g as unknown as Record<string, unknown>)[m];
    if (!has(v)) out.push({ ruleId: `meta.required.${m}`, severity: "BLOCKING_ERROR", message: `Metadata "${m}" is required by this template.`, explanation: "Template metadata drives search, application-aware guidance and health checks." });
  }

  // Governance
  if (!g.ownerId) out.push({ ruleId: "governance.owner_missing", severity: "BLOCKING_ERROR", message: "No process owner assigned.", explanation: "Every guide needs an accountable process owner." });
  else if (!i.ownerActive) out.push({ ruleId: "governance.owner_inactive", severity: open ? "BLOCKING_ERROR" : "WARNING", message: "The process owner is inactive.", explanation: "An inactive owner cannot review or maintain the guide. Reassign ownership." });
  if (!g.backupOwnerId) out.push({ ruleId: "governance.backup_owner_missing", severity: "BLOCKING_ERROR", message: "No backup owner assigned.", explanation: "A backup owner prevents the guide becoming orphaned." });
  if (!g.escalationUserId && !g.escalationPath.trim()) out.push({ ruleId: "governance.escalation_missing", severity: "BLOCKING_ERROR", message: "No escalation path defined.", explanation: "Define who is contacted if the owners are unavailable." });
  if (!(g.reviewFrequencyDays > 0)) out.push({ ruleId: "governance.review_frequency", severity: "BLOCKING_ERROR", message: "No review frequency set.", explanation: "Set how often the guide must be reviewed." });
  if (!i.hasWorkflow) out.push({ ruleId: "approval.route_missing", severity: "BLOCKING_ERROR", message: "No approval route is configured for this guide.", explanation: "Assign a workflow or configure an organisation default." });
  if (i.version.number > 1 && open && !i.version.revisionSummary.trim())
    out.push({ ruleId: "change_summary.missing", severity: "BLOCKING_ERROR", message: "No change summary for this revision.", explanation: "Approvers need a summary of what changed and why." });
  if (!i.version.importConfirmed) out.push({ ruleId: "import.unconfirmed", severity: "BLOCKING_ERROR", message: "Imported content has not been confirmed by a person.", explanation: "Imported content is untrusted until a human confirms it. Review the conversion and confirm it." });

  // Images
  for (const s of steps) {
    if (!s.image) continue;
    if (s.image.needsReplacement) out.push({ ruleId: "image.replace_flagged", severity: "BLOCKING_ERROR", stepId: s.id, message: `A screenshot is flagged for replacement${s.image.replaceReason ? ": " + s.image.replaceReason : "."}`, explanation: "Replace the screenshot with a current one, or confirm the existing screenshot is still accurate." });
    if (!s.image.alt.trim()) out.push({ ruleId: "image.alt_missing", severity: "WARNING", stepId: s.id, message: "Screenshot has no alt text.", explanation: "Alt text is required for accessibility (WCAG 2.2 AA)." });
    const sensitive = s.origin.flags.find((f) => f.code === "sensitive-content");
    if (sensitive && !s.image.annotations.some((a) => a.kind === "blur")) out.push({ ruleId: "image.sensitive", severity: "WARNING", stepId: s.id, message: "Screenshot may contain sensitive information that is not redacted.", explanation: sensitive.message });
    if (!i.existingAssetIds.has(s.image.assetId)) out.push({ ruleId: "attachment.missing", severity: "BLOCKING_ERROR", stepId: s.id, message: "Screenshot file is missing.", explanation: "The referenced image no longer exists in storage." });
  }
  for (const a of c.attachments) if (!i.existingAssetIds.has(a.assetId)) out.push({ ruleId: `attachment.missing.${a.assetId}`, severity: "BLOCKING_ERROR", message: `Attachment "${a.name}" is missing.`, explanation: "Re-upload the attachment or remove the reference." });

  // Links
  for (const s of steps) for (const l of s.links) if (!isSafeUrl(l.url)) out.push({ ruleId: `link.unsafe.${s.id}`, severity: "BLOCKING_ERROR", stepId: s.id, message: `Link "${l.label}" uses a disallowed URL scheme.`, explanation: "Only http, https, mailto and relative links are permitted." });
  for (const r of c.related) if (r.documentId && !i.liveRelatedDocIds.has(r.documentId)) out.push({ ruleId: `link.related_missing.${r.documentId}`, severity: "WARNING", message: `Related guide ${r.documentId} is not currently published.`, explanation: "The related-guide link would not resolve to a live guide." });

  // Acronyms
  const alltext = [c.purpose, c.scope, c.expectedResult, ...c.prerequisites, ...steps.map(stepPlainText)].join(" \n ");
  const found = new Set<string>();
  for (const m of alltext.matchAll(/\b[A-Z]{2,6}\b/g)) found.add(m[0]);
  const defined = new Set([...c.acronyms.map((a) => a.term.toUpperCase()), ...i.knownAcronyms]);
  const undef = [...found].filter((a) => !COMMON_ACRONYMS.has(a) && !defined.has(a) && !g.sapTransactions.map((t) => t.toUpperCase()).includes(a));
  if (undef.length) out.push({ ruleId: "acronym.undefined", severity: "SUGGESTION", message: `Undefined acronyms: ${undef.slice(0, 10).join(", ")}${undef.length > 10 ? "…" : ""}`, explanation: "Define acronyms on first use or in the Definitions section.", evidence: { terms: undef } });

  // Retired references
  const hay = (alltext + " " + [...g.systems, ...g.applications, ...g.sapTransactions].join(" ")).toLowerCase();
  for (const r of i.retired) {
    const re = new RegExp(`(^|[^a-z0-9])${r.value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    if (re.test(hay)) out.push({ ruleId: `retired.${r.kind}.${r.value}`.slice(0, 120), severity: "WARNING", message: `References ${r.kind.toLowerCase()} "${r.value}", which is flagged as retired.${r.replacement ? ` Suggested replacement: ${r.replacement}.` : ""}`, explanation: r.note || "Registered as retired in the organisation's retired-reference register. Verify whether this guide is still accurate.", evidence: { replacement: r.replacement } });
  }

  // Decisions
  for (const s of steps) if (s.decision) for (const b of s.decision.branches) if (b.steps.length === 0) out.push({ ruleId: `decision.empty_branch.${b.id}`, severity: "WARNING", stepId: s.id, message: `Decision branch "${b.label}" has no steps.`, explanation: "Every path from a decision should lead somewhere (steps or an exception)." });
  // Capture-generator flags
  for (const s of steps) for (const f of s.origin.flags) if (["ambiguous", "redundant"].includes(f.code)) out.push({ ruleId: `step.${f.code}`, severity: "SUGGESTION", stepId: s.id, message: f.message, explanation: "Raised by step generation from the recording; confirm or edit the step." });

  // Live-only
  if (live) {
    if (i.version.reviewDate && i.version.reviewDate < i.now) {
      const days = Math.floor((i.now.getTime() - i.version.reviewDate.getTime()) / 86400000);
      out.push({ ruleId: "review.overdue", severity: "WARNING", message: `Review was due ${days} day(s) ago (${i.version.reviewDate.toISOString().slice(0, 10)}).`, explanation: "Published guides must be reviewed at the frequency set by the owner.", evidence: { daysOverdue: days } });
    }
    if (i.feedback.outdatedOpen >= 2) out.push({ ruleId: "feedback.outdated_reports", severity: "WARNING", message: `${i.feedback.outdatedOpen} open reports say this guide is outdated.`, explanation: "Repeated outdated-content reports suggest the process or system has changed.", evidence: { count: i.feedback.outdatedOpen } });
    if (i.feedback.ratingCount >= 3 && i.feedback.ratingAvg !== null && i.feedback.ratingAvg < 3)
      out.push({ ruleId: "feedback.low_rating", severity: "WARNING", message: `Average rating is ${i.feedback.ratingAvg.toFixed(1)}/5 across ${i.feedback.ratingCount} ratings.`, explanation: "Consistently low ratings suggest the guide is unclear or inaccurate.", evidence: { avg: i.feedback.ratingAvg } });
  }
  return out;
}

async function buildInput(orgId: string, versionId: string): Promise<HealthInput> {
  const v = await prisma.guideVersion.findFirst({ where: { id: versionId, orgId }, include: { guide: { include: { template: true } } } });
  if (!v) throw notFound("Version");
  const g = v.guide;
  const content = guideContentSchema.parse(v.content);
  const [owner, backup, workflow, defWf, retired, acr, assets, fb] = await Promise.all([
    g.ownerId ? prisma.user.findFirst({ where: { id: g.ownerId, orgId }, select: { active: true } }) : null,
    g.backupOwnerId ? prisma.user.findFirst({ where: { id: g.backupOwnerId, orgId }, select: { active: true } }) : null,
    g.workflowId ? prisma.workflow.findFirst({ where: { id: g.workflowId, orgId } }) : null,
    prisma.workflow.findFirst({ where: { orgId, isDefault: true } }),
    prisma.retiredReference.findMany({ where: { orgId } }),
    prisma.synonym.findMany({ where: { orgId, kind: "ACRONYM" } }),
    (async () => {
      const ids = new Set<string>();
      for (const s of flattenSteps(content.steps)) if (s.image) ids.add(s.image.assetId);
      for (const a of content.attachments) ids.add(a.assetId);
      const rows = await prisma.asset.findMany({ where: { orgId, id: { in: [...ids] } }, select: { id: true } });
      return new Set(rows.map((r) => r.id));
    })(),
    prisma.feedback.findMany({ where: { guideId: g.id, versionId: v.id } }),
  ]);
  const relDocIds = content.related.map((r) => r.documentId).filter((x): x is string => !!x);
  const relGuides = relDocIds.length ? await prisma.guide.findMany({ where: { orgId, documentId: { in: relDocIds }, liveVersionId: { not: null }, archivedAt: null }, select: { documentId: true } }) : [];
  const ratings = fb.filter((f) => f.kind === "RATING" && f.rating != null);
  return {
    guide: { id: g.id, documentId: g.documentId, ownerId: g.ownerId, backupOwnerId: g.backupOwnerId, escalationUserId: g.escalationUserId, escalationPath: g.escalationPath, reviewFrequencyDays: g.reviewFrequencyDays, workflowId: g.workflowId, systems: g.systems, applications: g.applications, sapTransactions: g.sapTransactions, siteId: g.siteId, processCode: g.processCode },
    version: { id: v.id, number: v.number, status: v.status as GuideStatus, reviewDate: v.reviewDate, revisionSummary: v.revisionSummary, importConfirmed: v.importConfirmed },
    content, template: g.template.definition as unknown as TemplateDef,
    ownerActive: !!owner?.active, backupActive: !!backup?.active, hasWorkflow: !!(workflow ?? defWf),
    retired, knownAcronyms: new Set(acr.map((a) => a.term.toUpperCase())), existingAssetIds: assets,
    liveRelatedDocIds: new Set(relGuides.map((r) => r.documentId)),
    feedback: { outdatedOpen: fb.filter((f) => f.kind === "OUTDATED" && f.status === "OPEN").length, ratingCount: ratings.length, ratingAvg: ratings.length ? ratings.reduce((a, f) => a + (f.rating ?? 0), 0) / ratings.length : null },
    now: new Date(),
  };
}

/** Evaluate and persist findings for one version. Accepted exceptions survive re-evaluation while the condition persists. */
export async function runHealth(orgId: string, versionId: string) {
  const input = await buildInput(orgId, versionId);
  const cands = evaluate(input);
  const existing = await prisma.healthFinding.findMany({ where: { versionId } });
  const keyOf = (r: string, s?: string | null) => `${r}|${s ?? NO_STEP}`;
  const seen = new Set<string>();
  for (const c of cands) {
    const k = keyOf(c.ruleId, c.stepId);
    seen.add(k);
    const prev = existing.find((e) => keyOf(e.ruleId, e.stepId) === k);
    const data = { severity: c.severity, message: c.message, explanation: c.explanation, evidence: (c.evidence ?? {}) as object };
    if (prev) {
      await prisma.healthFinding.update({ where: { id: prev.id }, data: { ...data, status: prev.status === "ACCEPTED_EXCEPTION" ? "ACCEPTED_EXCEPTION" : "OPEN" } });
    } else {
      await prisma.healthFinding.create({ data: { orgId, guideId: input.guide.id, versionId, ruleId: c.ruleId, stepId: c.stepId ?? NO_STEP, ...data } });
    }
  }
  for (const e of existing) if (!seen.has(keyOf(e.ruleId, e.stepId)) && e.status !== "RESOLVED") await prisma.healthFinding.update({ where: { id: e.id }, data: { status: "RESOLVED" } });
  return listFindings(orgId, versionId);
}

export async function listFindings(orgId: string, versionId: string) {
  const rows = await prisma.healthFinding.findMany({ where: { orgId, versionId, status: { not: "RESOLVED" } }, orderBy: [{ severity: "asc" }, { detectedAt: "asc" }] });
  return rows.map((r) => ({ ...r, effectiveSeverity: r.status === "ACCEPTED_EXCEPTION" ? ("ACCEPTED_EXCEPTION" as const) : r.severity }));
}

export function assess(findings: { effectiveSeverity: string }[]) {
  const counts = { BLOCKING_ERROR: 0, WARNING: 0, SUGGESTION: 0, ACCEPTED_EXCEPTION: 0 } as Record<string, number>;
  for (const f of findings) counts[f.effectiveSeverity] = (counts[f.effectiveSeverity] ?? 0) + 1;
  const level = counts.BLOCKING_ERROR ? "blocked" : counts.WARNING ? "attention" : "healthy";
  const summary = level === "blocked"
    ? `${counts.BLOCKING_ERROR} blocking error(s) must be fixed or accepted as exceptions before the guide can be submitted.`
    : level === "attention" ? `${counts.WARNING} warning(s) to review; none block submission.` : "No blocking errors or warnings.";
  return { level, counts, summary };
}

export async function blockingFindings(orgId: string, versionId: string) {
  return (await runHealth(orgId, versionId)).filter((f) => f.effectiveSeverity === "BLOCKING_ERROR");
}

export async function acceptException(ctx: Ctx, findingId: string, reason: string) {
  if (!hasRole(ctx, "PROCESS_OWNER", "APPROVER", "ADMIN")) throw forbidden("Only a process owner, approver or administrator can accept an exception");
  if (reason.trim().length < 5) throw forbidden("A reason is required to accept an exception");
  const f = await prisma.healthFinding.findFirst({ where: { id: findingId, orgId: ctx.orgId }, include: { guide: true } });
  if (!f || !canSeeGuide(ctx, f.guide)) throw notFound("Finding");
  const u = await prisma.healthFinding.update({ where: { id: f.id }, data: { status: "ACCEPTED_EXCEPTION", exceptionReason: reason, acceptedById: ctx.userId } });
  await audit(ctx, null, { action: "HEALTH_EXCEPTION_ACCEPTED", entityType: "HealthFinding", entityId: f.id, guideId: f.guideId, versionId: f.versionId, summary: `Accepted exception for ${f.ruleId}`, detail: { reason, ruleId: f.ruleId } });
  return u;
}

export async function reopenException(ctx: Ctx, findingId: string) {
  if (!hasRole(ctx, "PROCESS_OWNER", "APPROVER", "ADMIN")) throw forbidden();
  const f = await prisma.healthFinding.findFirst({ where: { id: findingId, orgId: ctx.orgId }, include: { guide: true } });
  if (!f || !canSeeGuide(ctx, f.guide)) throw notFound("Finding");
  await prisma.healthFinding.update({ where: { id: f.id }, data: { status: "OPEN", exceptionReason: null, acceptedById: null } });
  await audit(ctx, null, { action: "HEALTH_EXCEPTION_REOPENED", entityType: "HealthFinding", entityId: f.id, guideId: f.guideId, versionId: f.versionId, summary: `Reopened ${f.ruleId}` });
}

async function recommend(orgId: string, guideId: string, versionId: string | null, source: string, reasons: unknown[]) {
  const dedupeKey = `${source}:${versionId ?? guideId}`;
  const open = await prisma.reviewRecommendation.findFirst({ where: { guideId, dedupeKey, status: "OPEN" } });
  if (open) {
    await prisma.reviewRecommendation.update({ where: { id: open.id }, data: { reasons: reasons as object } });
    return { created: false };
  }
  await prisma.reviewRecommendation.create({ data: { orgId, guideId, versionId, source, reasons: reasons as object, dedupeKey } });
  return { created: true };
}

/**
 * Organisation-wide scan (worker job / admin action). Evaluates live guides, detects duplicates and orphans, and files
 * review recommendations. Approved content is never modified.
 */
export async function runOrgHealthScan(orgId: string, actor?: Ctx) {
  const guides = await prisma.guide.findMany({ where: { orgId, liveVersionId: { not: null }, archivedAt: null } });
  const summary = { guidesScanned: guides.length, findings: 0, recommendationsCreated: 0, orphans: 0, duplicatePairs: 0 };
  const contents = new Map<string, GuideContent>();
  for (const g of guides) {
    const findings = await runHealth(orgId, g.liveVersionId!);
    summary.findings += findings.length;
    const v = await prisma.guideVersion.findUniqueOrThrow({ where: { id: g.liveVersionId! } });
    contents.set(g.id, guideContentSchema.parse(v.content));
    const bySource: Record<string, typeof findings> = {};
    for (const f of findings) {
      const src = f.ruleId === "review.overdue" ? "OVERDUE_REVIEW" : f.ruleId.startsWith("retired.") ? "RETIRED_REFERENCE" : f.ruleId === "feedback.outdated_reports" ? "OUTDATED_REPORTS" : f.ruleId === "feedback.low_rating" ? "LOW_RATING" : null;
      if (src && f.effectiveSeverity !== "ACCEPTED_EXCEPTION") (bySource[src] ??= []).push(f);
    }
    for (const [src, fs] of Object.entries(bySource)) {
      const r = await recommend(orgId, g.id, g.liveVersionId, src, fs.map((f) => ({ ruleId: f.ruleId, message: f.message, explanation: f.explanation })));
      if (r.created) {
        summary.recommendationsCreated++;
        await notify(orgId, [g.ownerId, g.backupOwnerId], "review_recommendation", `Review recommended for ${g.documentId}: ${fs[0].message}`, `/guides/${g.id}`);
      }
    }
  }
  // Orphans: missing or inactive owner
  const users = await prisma.user.findMany({ where: { orgId }, select: { id: true, active: true } });
  const active = new Set(users.filter((u) => u.active).map((u) => u.id));
  const admins = await usersWithRole(orgId, "ADMIN");
  for (const g of guides) {
    const ownerOk = g.ownerId && active.has(g.ownerId);
    if (!ownerOk) {
      summary.orphans++;
      if (!g.orphanedSince) await prisma.guide.update({ where: { id: g.id }, data: { orphanedSince: new Date() } });
      const r = await recommend(orgId, g.id, g.liveVersionId, "ORPHANED", [{ ruleId: "governance.owner_inactive", message: g.ownerId ? "Process owner is inactive." : "No process owner.", explanation: "Reassign ownership so the guide keeps being reviewed." }]);
      if (r.created) {
        summary.recommendationsCreated++;
        await notify(orgId, [g.backupOwnerId, g.escalationUserId, ...admins], "orphaned_guide", `${g.documentId} "${g.title}" has no active owner`, `/guides/${g.id}`);
      }
    } else if (g.orphanedSince) await prisma.guide.update({ where: { id: g.id }, data: { orphanedSince: null } });
  }
  // Duplicates / near duplicates
  const ids = guides.map((g) => g.id);
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    const A = contents.get(ids[a])!, B = contents.get(ids[b])!;
    const text = (c: GuideContent) => [c.title, c.purpose, ...flattenSteps(c.steps).map(stepPlainText)].join(" ");
    const sim = similarity(text(A), text(B));
    if (sim >= 0.8) {
      summary.duplicatePairs++;
      const ga = guides[a], gb = guides[b];
      for (const [x, y, gx] of [[ga, gb, ga], [gb, ga, gb]] as const) {
        const ex = await prisma.healthFinding.findFirst({ where: { versionId: x.liveVersionId!, ruleId: `duplicate.near.${y.documentId}` } });
        if (!ex) await prisma.healthFinding.create({ data: { orgId, guideId: gx.id, versionId: x.liveVersionId!, ruleId: `duplicate.near.${y.documentId}`, stepId: NO_STEP, severity: "WARNING", message: `Near-duplicate of ${y.documentId} (${Math.round(sim * 100)}% similar).`, explanation: "Similar guides cause conflicting instructions. Consider merging or superseding one.", evidence: { other: y.documentId, similarity: sim } } });
      }
      await recommend(orgId, ga.id, ga.liveVersionId, "DUPLICATE", [{ ruleId: "duplicate.near", message: `Near-duplicate of ${gb.documentId}`, explanation: `${Math.round(sim * 100)}% textual similarity` }]);
    }
  }
  await audit(actor ?? null, orgId, { action: "HEALTH_SCAN", entityType: "Organization", entityId: orgId, summary: `Health scan: ${summary.guidesScanned} guides, ${summary.findings} findings, ${summary.recommendationsCreated} new recommendations`, detail: summary });
  return summary;
}

export async function resolveRecommendation(ctx: Ctx, id: string, decision: "ACCEPTED" | "DISMISSED", note: string) {
  const rec = await prisma.reviewRecommendation.findFirst({ where: { id, orgId: ctx.orgId }, include: { guide: true } });
  if (!rec || !canSeeGuide(ctx, rec.guide)) throw notFound("Recommendation");
  const g = rec.guide;
  if (!(hasRole(ctx, "ADMIN", "PUBLISHER") || g.ownerId === ctx.userId || g.backupOwnerId === ctx.userId)) throw forbidden("Only the owner, backup owner, a publisher or an administrator can act on a recommendation");
  if (rec.status !== "OPEN") throw forbidden("Recommendation already resolved");
  if (decision === "DISMISSED" && note.trim().length < 5) throw forbidden("A note is required when dismissing");
  await prisma.reviewRecommendation.update({ where: { id }, data: { status: decision, resolvedById: ctx.userId, resolvedAt: new Date(), resolutionNote: note } });
  let markedUnderReview = false;
  if (decision === "ACCEPTED" && g.liveVersionId) {
    const v = await prisma.guideVersion.findUniqueOrThrow({ where: { id: g.liveVersionId } });
    if (v.status === "PUBLISHED") {
      await prisma.guideVersion.update({ where: { id: v.id }, data: { status: "UNDER_REVIEW" } });
      markedUnderReview = true;
    }
  }
  await audit(ctx, null, { action: `RECOMMENDATION_${decision}`, entityType: "ReviewRecommendation", entityId: id, guideId: g.id, versionId: rec.versionId, summary: `${decision === "ACCEPTED" ? "Accepted" : "Dismissed"} ${rec.source} recommendation`, detail: { note, markedUnderReview } });
  return { ok: true, markedUnderReview };
}
