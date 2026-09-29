// Suggestions (from rules or AI) are stored SEPARATELY from guide content and only applied on explicit human acceptance.
import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { forbidden, notFound, conflict, unprocessable } from "../errors";
import { getVersionDetail, saveContent } from "./guides";
import { newStep, newId, flattenSteps, type GuideContent, type Step } from "../../lib/guide-schema";

export const SUGGESTION_KINDS = ["warning", "validation", "note", "rewrite", "prerequisite", "acronym", "quiz", "summary", "faq", "translation", "mismatch", "term"] as const;
export interface SuggestionInput { kind: (typeof SUGGESTION_KINDS)[number]; stepId?: string; payload: Record<string, unknown>; uncertainty?: Record<string, unknown> }

export async function createSuggestions(ctx: Ctx, versionId: string, items: SuggestionInput[], provider: string, promptVersion: string) {
  const v = await prisma.guideVersion.findFirst({ where: { id: versionId, orgId: ctx.orgId } });
  if (!v) throw notFound("Version");
  const rows = [];
  for (const i of items) {
    rows.push(await prisma.aiSuggestion.create({ data: { orgId: ctx.orgId, guideId: v.guideId, versionId, stepId: i.stepId, kind: i.kind, provider, promptVersion, payload: i.payload as object, uncertainty: (i.uncertainty ?? {}) as object, createdById: ctx.userId } }));
  }
  return rows;
}

export async function listSuggestions(ctx: Ctx, versionId: string) {
  await getVersionDetail(ctx, versionId); // authorises read
  return prisma.aiSuggestion.findMany({ where: { orgId: ctx.orgId, versionId }, orderBy: { createdAt: "asc" } });
}

function insertAfter(steps: Step[], afterId: string | undefined, step: Step): Step[] {
  if (!afterId) return [...steps, step];
  const i = steps.findIndex((s) => s.id === afterId);
  if (i >= 0) return [...steps.slice(0, i + 1), step, ...steps.slice(i + 1)];
  return steps.map((s) => s.decision ? { ...s, decision: { ...s.decision, branches: s.decision.branches.map((b) => ({ ...b, steps: insertAfter(b.steps, afterId, step) })) } } : s);
}
function replaceIn(steps: Step[], id: string, patch: Partial<Step>): Step[] {
  return steps.map((s) => s.id === id ? { ...s, ...patch } : s.decision ? { ...s, decision: { ...s.decision, branches: s.decision.branches.map((b) => ({ ...b, steps: replaceIn(b.steps, id, patch) })) } } : s);
}

export function applySuggestion(content: GuideContent, s: { kind: string; stepId: string | null; payload: unknown; provider: string }): GuideContent {
  const p = z.record(z.string(), z.unknown()).parse(s.payload);
  const text = String(p.text ?? "");
  const origin = { type: "ai" as const, provider: s.provider, flags: [] };
  const c: GuideContent = JSON.parse(JSON.stringify(content));
  switch (s.kind) {
    case "warning": case "note":
      c.steps = insertAfter(c.steps, s.stepId ?? undefined, newStep(s.kind === "warning" ? "warning" : "note", { title: "", text, origin }));
      return c;
    case "validation": if (text && !c.validationChecks.includes(text)) c.validationChecks.push(text); return c;
    case "prerequisite": if (text && !c.prerequisites.includes(text)) c.prerequisites.push(text); return c;
    case "acronym": c.acronyms.push({ term: String(p.term ?? "").slice(0, 40), expansion: String(p.expansion ?? "").slice(0, 300) }); return c;
    case "rewrite": {
      if (!s.stepId || !flattenSteps(c.steps).some((x) => x.id === s.stepId)) throw conflict("The step this suggestion targets no longer exists");
      c.steps = replaceIn(c.steps, s.stepId, { title: String(p.title ?? ""), text, origin: { ...(flattenSteps(c.steps).find((x) => x.id === s.stepId)!.origin), type: "ai", provider: s.provider } });
      return c;
    }
    case "quiz": {
      const q = z.object({ question: z.string().max(500), options: z.array(z.string().max(300)).min(2).max(6), correctIndex: z.number().int().min(0).max(5) }).parse(p);
      c.competency.quiz.push(q);
      return c;
    }
    default: throw unprocessable(`Suggestions of kind "${s.kind}" are informational and cannot be applied automatically`);
  }
}

export async function decideSuggestion(ctx: Ctx, id: string, decision: "ACCEPTED" | "REJECTED") {
  const s = await prisma.aiSuggestion.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!s) throw notFound("Suggestion");
  if (s.status !== "PENDING") throw conflict("Suggestion already decided");
  const d = await getVersionDetail(ctx, s.versionId); // authorises read
  if (!d.canEdit) throw forbidden("You cannot edit this version, so you cannot accept suggestions into it");
  if (decision === "ACCEPTED") {
    const next = applySuggestion(d.content, s);
    await saveContent(ctx, s.versionId, next, d.rev);
  }
  await prisma.aiSuggestion.update({ where: { id }, data: { status: decision, decidedById: ctx.userId, decidedAt: new Date() } });
  await audit(ctx, null, { action: `SUGGESTION_${decision}`, entityType: "AiSuggestion", entityId: id, guideId: s.guideId, versionId: s.versionId, summary: `${decision === "ACCEPTED" ? "Accepted" : "Rejected"} ${s.provider} ${s.kind} suggestion`, detail: { provider: s.provider, promptVersion: s.promptVersion, kind: s.kind } });
  return { ok: true };
}

export { newId };
