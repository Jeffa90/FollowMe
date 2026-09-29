// Browser-capture ingestion. Events are stored as immutable EVIDENCE; editable steps are generated separately.
// Guardrails enforced server-side (never trust the extension): kill switch, restricted domains, no values/keystrokes, text redaction.
import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { hasRole } from "../ctx";
import { forbidden, notFound, conflict, unprocessable } from "../errors";
import { capturePolicySchema, hostRestricted, type CapturePolicy } from "../../lib/policy";
import { storeAsset } from "./assets";
import { createGuide, getVersionDetail, saveContent, type GuideMetadata } from "./guides";
import { createSuggestions } from "./suggestions";
import { generateFromEvents, stepFromEvent, type CapturedEvent } from "../../lib/stepgen";
import { compareContent } from "../../lib/compare";
import { guideContentSchema, flattenSteps, type Step } from "../../lib/guide-schema";
import { blobStore } from "../storage";

export async function getCapturePolicy(ctx: Ctx): Promise<CapturePolicy> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  return capturePolicySchema.parse(org.capturePolicy ?? {});
}

function assertCaptureAllowed(ctx: Ctx, policy: CapturePolicy) {
  if (!policy.enabled) throw forbidden("Capture is disabled by your organisation (kill switch)");
  if (!hasRole(ctx, "AUTHOR")) throw forbidden("Only authors can capture processes");
}

const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ""; } };
/** Defence in depth: query strings and fragments are never stored (they routinely contain tokens, emails and other secrets). */
export const safeUrl = (u: string) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return ""; } };

export async function startSession(ctx: Ctx, input: unknown) {
  const { startUrl, title, extensionVersion } = z.object({ startUrl: z.string().max(2000), title: z.string().max(200).optional(), extensionVersion: z.string().max(30).optional() }).parse(input);
  const policy = await getCapturePolicy(ctx);
  assertCaptureAllowed(ctx, policy);
  if (hostRestricted(hostOf(startUrl), policy.restrictedDomains)) throw forbidden(`Recording is not permitted on ${hostOf(startUrl)} (restricted domain)`);
  const s = await prisma.captureSession.create({ data: { orgId: ctx.orgId, userId: ctx.userId, startUrl: safeUrl(startUrl), title, extensionVersion, policySnapshot: policy as object } });
  await audit(ctx, null, { action: "CAPTURE_STARTED", entityType: "CaptureSession", entityId: s.id, summary: `Capture started on ${hostOf(startUrl)}`, detail: { via: ctx.via } });
  return s;
}

const targetSchema = z.object({
  tag: z.string().max(30).optional(), role: z.string().max(40).optional(), name: z.string().max(200).optional(), label: z.string().max(200).optional(),
  inputType: z.string().max(30).optional(), placeholder: z.string().max(200).optional(), optionLabel: z.string().max(200).optional(), checked: z.boolean().optional(),
  testId: z.string().max(100).optional(), id: z.string().max(100).optional(), selectorHint: z.string().max(300).optional(), hrefPath: z.string().max(300).optional(),
  valueLength: z.number().int().min(0).max(100000).optional(), sensitive: z.boolean().optional(),
}).strip(); // unknown keys (e.g. "value") are discarded, never stored

const eventSchema = z.object({
  seq: z.number().int().min(0).max(5000),
  type: z.enum(["click", "change", "submit", "navigate"]),
  at: z.string().datetime(),
  url: z.string().max(2000), pageTitle: z.string().max(300).default(""),
  target: targetSchema.default({}),
  viewport: z.object({ width: z.number().max(20000), height: z.number().max(20000), dpr: z.number().max(10).optional() }).optional(),
  rect: z.object({ x: z.number(), y: z.number(), w: z.number().min(0), h: z.number().min(0) }).nullable().optional(),
  screenshot: z.string().max(9_000_000).optional(), // data URL
  redactions: z.array(z.object({ reason: z.string().max(60), count: z.number().int().max(1000).optional() })).max(50).default([]),
  sensitiveHits: z.number().int().min(0).max(100000).default(0),
});

export function redactText(s: string | undefined, policy: CapturePolicy): string | undefined {
  if (!s) return s;
  let out = s;
  for (const p of policy.redactPatterns) {
    try { out = out.replace(new RegExp(p.regex, "g"), "[redacted]"); } catch { /* invalid admin regex ignored */ }
  }
  return out;
}

async function ownedSession(ctx: Ctx, id: string, allowAudit = false) {
  const s = await prisma.captureSession.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!s || (s.userId !== ctx.userId && !(allowAudit && hasRole(ctx, "AUDITOR", "ADMIN")))) throw notFound("Capture session");
  return s;
}

export async function recordEvent(ctx: Ctx, sessionId: string, raw: unknown) {
  const s = await ownedSession(ctx, sessionId);
  const policy = await getCapturePolicy(ctx);
  assertCaptureAllowed(ctx, policy);
  if (s.status !== "RECORDING") throw conflict(`Session is ${s.status}; events are only accepted while recording`);
  if (s.eventCount >= policy.maxEventsPerSession) throw unprocessable("Session event limit reached");
  const e = eventSchema.parse(raw);
  if (hostRestricted(hostOf(e.url), policy.restrictedDomains)) {
    await prisma.captureSession.update({ where: { id: s.id }, data: { status: "PAUSED" } });
    await audit(ctx, null, { action: "CAPTURE_BLOCKED_RESTRICTED", entityType: "CaptureSession", entityId: s.id, summary: `Event on restricted domain ${hostOf(e.url)} rejected; session paused` });
    throw new (await import("../errors")).AppError(422, "restricted_domain", `Recording is not permitted on ${hostOf(e.url)}`);
  }
  const target = { ...e.target, name: redactText(e.target.name, policy), label: redactText(e.target.label, policy), placeholder: redactText(e.target.placeholder, policy), optionLabel: redactText(e.target.optionLabel, policy) };
  let screenshotAssetId: string | null = null;
  if (e.screenshot) {
    const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(e.screenshot);
    if (!m) throw unprocessable("Screenshot must be a PNG or JPEG data URL");
    const a = await storeAsset(ctx, { buffer: Buffer.from(m[2], "base64"), filename: `capture-${s.id}-${e.seq}.${m[1] === "jpeg" ? "jpg" : "png"}`, purpose: "EVIDENCE", allow: ["png", "jpeg"], captureSessionId: s.id });
    screenshotAssetId = a.id;
  }
  const ev = await prisma.$transaction(async (tx) => {
    const created = await tx.captureEvent.upsert({
      where: { sessionId_seq: { sessionId: s.id, seq: e.seq } },
      create: { orgId: ctx.orgId, sessionId: s.id, seq: e.seq, type: e.type, at: new Date(e.at), url: safeUrl(e.url), pageTitle: redactText(e.pageTitle, policy) ?? "", target: target as object, viewport: (e.viewport ?? {}) as object, rect: e.rect ?? undefined, screenshotAssetId, redactions: e.redactions as object[], sensitiveHits: e.sensitiveHits },
      update: {}, // events are append-only evidence; a retried upload of the same seq is a no-op
    });
    await tx.captureSession.update({ where: { id: s.id }, data: { eventCount: await tx.captureEvent.count({ where: { sessionId: s.id } }) } });
    return created;
  });
  return { id: ev.id, seq: ev.seq };
}

export async function setSessionStatus(ctx: Ctx, id: string, status: "RECORDING" | "PAUSED" | "STOPPED" | "DISCARDED") {
  const s = await ownedSession(ctx, id);
  const policy = await getCapturePolicy(ctx);
  if (!policy.enabled && status === "RECORDING") throw forbidden("Capture is disabled by your organisation (kill switch)");
  // Allowed: RECORDING<->PAUSED, (RECORDING|PAUSED)->STOPPED, anything not yet processed -> DISCARDED. Nothing leaves PROCESSED/DISCARDED.
  const ended = ["STOPPED", "PROCESSED", "DISCARDED"].includes(s.status);
  if (s.status !== status && (["PROCESSED", "DISCARDED"].includes(s.status) || (ended && status !== "DISCARDED"))) throw conflict(`Session is already ${s.status}`);
  const u = await prisma.captureSession.update({ where: { id }, data: { status, ...(status === "STOPPED" || status === "DISCARDED" ? { endedAt: new Date() } : {}) } });
  await audit(ctx, null, { action: `CAPTURE_${status}`, entityType: "CaptureSession", entityId: id, summary: `Capture ${status.toLowerCase()} (${u.eventCount} events)` });
  return u;
}

export async function getSession(ctx: Ctx, id: string) {
  const s = await ownedSession(ctx, id, true);
  const events = await prisma.captureEvent.findMany({ where: { sessionId: id }, orderBy: { seq: "asc" } });
  return { session: s, events };
}

export async function listSessions(ctx: Ctx) {
  return prisma.captureSession.findMany({ where: { orgId: ctx.orgId, userId: ctx.userId, status: { not: "DISCARDED" } }, orderBy: { startedAt: "desc" }, take: 50 });
}

/** Copy evidence screenshots to separate CONTENT assets (same bytes, content-addressed) so edits never touch evidence. */
async function contentAssetsFor(ctx: Ctx, events: { id: string; screenshotAssetId: string | null }[], guideId: string) {
  const map = new Map<string, string>();
  for (const e of events) {
    if (!e.screenshotAssetId) continue;
    const ev = await prisma.asset.findUniqueOrThrow({ where: { id: e.screenshotAssetId } });
    const copy = await prisma.asset.create({ data: { orgId: ev.orgId, sha256: ev.sha256, mime: ev.mime, size: ev.size, storageKey: ev.storageKey, originalName: ev.originalName, purpose: "CONTENT", width: ev.width, height: ev.height, createdById: ctx.userId, guideId, captureSessionId: ev.captureSessionId } });
    map.set(e.id, copy.id);
    await prisma.asset.update({ where: { id: ev.id }, data: { guideId } });
  }
  return map;
}

function toCaptured(rows: Awaited<ReturnType<typeof prisma.captureEvent.findMany>>, contentMap?: Map<string, string>): CapturedEvent[] {
  return rows.map((r) => ({
    id: r.id, seq: r.seq, type: r.type as CapturedEvent["type"], at: r.at, url: r.url, pageTitle: r.pageTitle, target: r.target as CapturedEvent["target"],
    viewport: r.viewport as CapturedEvent["viewport"], rect: r.rect as CapturedEvent["rect"], screenshotAssetId: r.screenshotAssetId, contentAssetId: contentMap?.get(r.id) ?? null,
    redactions: r.redactions as unknown[], sensitiveHits: r.sensitiveHits,
  }));
}

export async function generateGuideFromSession(ctx: Ctx, sessionId: string, opts: { title?: string; templateKey?: string; metadata?: GuideMetadata } = {}) {
  const s = await ownedSession(ctx, sessionId);
  if (s.status === "DISCARDED") throw conflict("This recording was discarded");
  if (s.status === "RECORDING" || s.status === "PAUSED") throw conflict("Stop the recording before generating a guide");
  if (s.guideId) throw conflict("A guide was already generated from this recording", { guideId: s.guideId });
  const rows = await prisma.captureEvent.findMany({ where: { sessionId }, orderBy: { seq: "asc" } });
  if (!rows.length) throw unprocessable("The recording has no events");
  // Two-phase: generate with placeholder asset ids, create the guide, then bind content assets.
  const draftGen = generateFromEvents(toCaptured(rows), { title: opts.title, templateKey: opts.templateKey });
  const { guide, version } = await createGuide(ctx, { title: draftGen.content.title, templateKey: opts.templateKey ?? "general", metadata: { websites: draftGen.application.host ? [draftGen.application.host] : [], applications: [draftGen.application.name], ...(opts.metadata ?? {}) }, source: "CAPTURE", sourceRef: sessionId });
  const contentMap = await contentAssetsFor(ctx, rows, guide.id);
  const gen = generateFromEvents(toCaptured(rows, contentMap), { title: opts.title, templateKey: opts.templateKey });
  const d = await getVersionDetail(ctx, version.id);
  await saveContent(ctx, version.id, { ...d.content, ...gen.content, templateKey: d.content.templateKey }, d.rev);
  if (gen.suggestions.length) {
    await createSuggestions(ctx, version.id, gen.suggestions.map((g) => ({ kind: g.kind, stepId: g.stepId, payload: { text: g.text }, uncertainty: { reason: g.reason } })), "rules", "stepgen-rules-1");
  }
  await prisma.captureSession.update({ where: { id: sessionId }, data: { status: "PROCESSED", guideId: guide.id, versionId: version.id } });
  await audit(ctx, null, { action: "CAPTURE_GENERATED", entityType: "CaptureSession", entityId: sessionId, guideId: guide.id, versionId: version.id, summary: `Generated ${gen.content.steps.length} steps from ${rows.length} recorded events (${gen.dropped.length} dropped)`, detail: { dropped: gen.dropped } });
  return { guideId: guide.id, versionId: version.id, steps: gen.content.steps.length, dropped: gen.dropped, suggestions: gen.suggestions.length };
}

/** "Add missed steps by recording again": generate steps from another session and insert them into an editable version. */
export async function appendSessionToVersion(ctx: Ctx, versionId: string, sessionId: string, afterStepId?: string) {
  const s = await ownedSession(ctx, sessionId);
  if (s.status === "DISCARDED") throw conflict("This recording was discarded");
  if (s.status === "RECORDING" || s.status === "PAUSED") throw conflict("Stop the recording first");
  const d = await getVersionDetail(ctx, versionId);
  if (!d.canEdit) throw forbidden("You cannot edit this version");
  const rows = await prisma.captureEvent.findMany({ where: { sessionId }, orderBy: { seq: "asc" } });
  const contentMap = await contentAssetsFor(ctx, rows, d.guideId);
  const gen = generateFromEvents(toCaptured(rows, contentMap));
  let steps = d.content.steps;
  const i = afterStepId ? steps.findIndex((x) => x.id === afterStepId) : steps.length - 1;
  steps = [...steps.slice(0, i + 1), ...gen.content.steps, ...steps.slice(i + 1)];
  await saveContent(ctx, versionId, { ...d.content, steps }, d.rev);
  await prisma.captureSession.update({ where: { id: sessionId }, data: { status: "PROCESSED", guideId: d.guideId, versionId } });
  await audit(ctx, null, { action: "CAPTURE_APPENDED", entityType: "CaptureSession", entityId: sessionId, guideId: d.guideId, versionId, summary: `Inserted ${gen.content.steps.length} recorded steps` });
  return { inserted: gen.content.steps.length };
}

/** Regenerate one step's wording from its original evidence event (returns a proposal; the editor applies it, undoably). */
export async function regenerateStep(ctx: Ctx, versionId: string, stepId: string): Promise<Pick<Step, "title" | "text">> {
  const d = await getVersionDetail(ctx, versionId);
  const step = flattenSteps(d.content.steps).find((x) => x.id === stepId);
  if (!step) throw notFound("Step");
  if (step.origin.type !== "capture" || !step.origin.eventId) throw unprocessable("Only steps generated from a recording can be regenerated from evidence");
  const ev = await prisma.captureEvent.findFirst({ where: { id: step.origin.eventId, orgId: ctx.orgId } });
  if (!ev) throw notFound("Evidence event");
  const fresh = stepFromEvent(toCaptured([ev])[0]);
  return { title: fresh.title, text: fresh.text };
}

/**
 * Compare a new recording with an existing guide. Differences (changed buttons/field names, missing or new steps) are reported;
 * optionally a review recommendation is filed. Approved content is never modified.
 */
export async function compareSessionWithGuide(ctx: Ctx, sessionId: string, guideId: string, opts: { fileRecommendation?: boolean } = {}) {
  await ownedSession(ctx, sessionId);
  const g = await prisma.guide.findFirst({ where: { id: guideId, orgId: ctx.orgId } });
  if (!g) throw notFound("Guide");
  const versionId = g.liveVersionId ?? (await prisma.guideVersion.findFirst({ where: { guideId, status: { in: ["DRAFT", "CHANGES_REQUESTED"] } }, orderBy: { number: "desc" } }))?.id;
  if (!versionId) throw notFound("Version");
  const v = await getVersionDetail(ctx, versionId);
  const rows = await prisma.captureEvent.findMany({ where: { sessionId }, orderBy: { seq: "asc" } });
  const gen = generateFromEvents(toCaptured(rows));
  const onlyActions = (steps: Step[]) => steps.filter((x) => x.kind === "action");
  // Screenshots always differ between a guide and a fresh recording; compare wording only.
  const textOnly = (steps: Step[]) => onlyActions(steps).map((x) => ({ ...x, image: undefined }));
  const diff = compareContent({ ...v.content, steps: textOnly(v.content.steps) }, { ...gen.content, steps: textOnly(gen.content.steps) }, 0.4);
  const mismatches = diff.steps.filter((x) => x.status !== "unchanged").length;
  let recommendationId: string | null = null;
  if (opts.fileRecommendation && mismatches > 0) {
    const rec = await prisma.reviewRecommendation.create({ data: { orgId: ctx.orgId, guideId, versionId, source: "RECORDING_MISMATCH", dedupeKey: `RECORDING_MISMATCH:${sessionId}`, reasons: diff.steps.filter((x) => x.status !== "unchanged").slice(0, 30).map((x) => ({ ruleId: `recording.${x.status}`, message: `${x.status}: ${x.left?.text ?? x.right?.text}`, explanation: "Compared a new recording with the published instruction." })) } });
    recommendationId = rec.id;
    await audit(ctx, null, { action: "RECORDING_MISMATCH_FILED", entityType: "ReviewRecommendation", entityId: rec.id, guideId, versionId, summary: `New recording differs from ${g.documentId} (${mismatches} differences)` });
  }
  return { diff, mismatches, recommendationId, comparedVersionId: versionId };
}

export async function discardSession(ctx: Ctx, id: string) {
  const s = await ownedSession(ctx, id);
  if (s.status === "PROCESSED") throw conflict("Cannot discard a recording that produced a guide");
  await setSessionStatus(ctx, id, "DISCARDED");
}

void blobStore; void guideContentSchema;

/** Preview what generation would produce (no writes): kept steps, dropped events with reasons, suggestions. */
export async function previewGeneration(ctx: Ctx, sessionId: string) {
  await ownedSession(ctx, sessionId);
  const rows = await prisma.captureEvent.findMany({ where: { sessionId }, orderBy: { seq: "asc" } });
  const gen = generateFromEvents(toCaptured(rows));
  return { title: gen.content.title, steps: gen.content.steps.map((s) => ({ id: s.id, text: s.text, eventId: s.origin.eventId, flags: s.origin.flags })), dropped: gen.dropped, suggestions: gen.suggestions, application: gen.application };
}
