// Training & competency. Opening a guide is NEVER treated as proof of competency: only explicit acknowledgement,
// a passed knowledge quiz, or a trainer/supervisor sign-off create records. Reporting is aggregate only (no rankings).
import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { hasRole } from "../ctx";
import { guideScope } from "../authz";
import { forbidden, notFound, conflict, unprocessable } from "../errors";
import { guideContentSchema } from "../../lib/guide-schema";
import { LIVE_STATUSES } from "../../lib/roles";

async function liveVersion(ctx: Ctx, versionId: string) {
  const v = await prisma.guideVersion.findFirst({ where: { id: versionId, orgId: ctx.orgId, status: { in: LIVE_STATUSES } }, include: { guide: true } });
  if (!v) throw notFound("Guide");
  const ok = await prisma.guide.findFirst({ where: { AND: [guideScope(ctx), { id: v.guideId }] } });
  if (!ok) throw notFound("Guide");
  return { v, content: guideContentSchema.parse(v.content) };
}

export async function markRead(ctx: Ctx, versionId: string) {
  const { v } = await liveVersion(ctx, versionId);
  const ex = await prisma.acknowledgement.findFirst({ where: { userId: ctx.userId, versionId, kind: "READ" } });
  if (!ex) await prisma.acknowledgement.create({ data: { orgId: ctx.orgId, guideId: v.guideId, versionId, userId: ctx.userId, kind: "READ" } });
  return { ok: true };
}

export async function acknowledge(ctx: Ctx, versionId: string) {
  const { v } = await liveVersion(ctx, versionId);
  const ex = await prisma.acknowledgement.findFirst({ where: { userId: ctx.userId, versionId, kind: "ACKNOWLEDGED" } });
  if (ex) return { ok: true, already: true };
  await prisma.acknowledgement.create({ data: { orgId: ctx.orgId, guideId: v.guideId, versionId, userId: ctx.userId, kind: "ACKNOWLEDGED" } });
  await audit(ctx, null, { action: "ACKNOWLEDGED", entityType: "GuideVersion", entityId: versionId, guideId: v.guideId, versionId, summary: `${ctx.name} acknowledged ${v.guide.documentId} v${v.label}` });
  return { ok: true };
}

export async function quizForLearner(ctx: Ctx, versionId: string) {
  const { content } = await liveVersion(ctx, versionId);
  return content.competency.quiz.map((q) => ({ question: q.question, options: q.options })); // correct answers are not sent to the client
}

export async function submitQuiz(ctx: Ctx, versionId: string, input: unknown) {
  const { answers } = z.object({ answers: z.array(z.number().int().min(0).max(5)) }).parse(input);
  const { v, content } = await liveVersion(ctx, versionId);
  const quiz = content.competency.quiz;
  if (!quiz.length) throw unprocessable("This guide has no knowledge quiz");
  if (answers.length !== quiz.length) throw unprocessable("Answer every question");
  const results = quiz.map((q, i) => answers[i] === q.correctIndex);
  const score = results.filter(Boolean).length;
  const passed = score / quiz.length >= 0.8;
  await prisma.quizAttempt.create({ data: { orgId: ctx.orgId, guideId: v.guideId, versionId, userId: ctx.userId, score, total: quiz.length, passed } });
  return { score, total: quiz.length, passed, results };
}

const signoffSchema = z.object({ learnerId: z.string(), checklist: z.array(z.object({ item: z.string().max(400), done: z.boolean() })).max(60), outcome: z.enum(["COMPETENT", "NOT_YET_COMPETENT"]) });

export async function signoff(ctx: Ctx, versionId: string, input: unknown) {
  if (!hasRole(ctx, "AUTHOR", "PROCESS_OWNER")) throw forbidden("Only trainers (authors) or supervisors (process owners) can sign off competency");
  const b = signoffSchema.parse(input);
  if (b.learnerId === ctx.userId) throw forbidden("You cannot sign off your own competency");
  const { v, content } = await liveVersion(ctx, versionId);
  const learner = await prisma.user.findFirst({ where: { id: b.learnerId, orgId: ctx.orgId, active: true } });
  if (!learner) throw notFound("Learner");
  if (b.outcome === "COMPETENT") {
    const required = content.competency.checklist;
    const done = new Set(b.checklist.filter((c) => c.done).map((c) => c.item));
    if (required.some((r) => !done.has(r))) throw conflict("Every checklist item must be demonstrated before recording 'competent'");
    if (content.competency.quizRequired) {
      const passed = await prisma.quizAttempt.findFirst({ where: { userId: b.learnerId, versionId, passed: true } });
      if (!passed) throw conflict("The learner has not passed the knowledge quiz for this version");
    }
  }
  const reassessOn = content.competency.reassessmentMonths && b.outcome === "COMPETENT" ? new Date(Date.now() + content.competency.reassessmentMonths * 30 * 86400_000) : null;
  const row = await prisma.competencySignoff.create({ data: { orgId: ctx.orgId, guideId: v.guideId, versionId, learnerId: b.learnerId, assessorId: ctx.userId, checklist: b.checklist as object[], outcome: b.outcome, reassessOn } });
  await audit(ctx, null, { action: "COMPETENCY_SIGNOFF", entityType: "CompetencySignoff", entityId: row.id, guideId: v.guideId, versionId, summary: `${ctx.name} recorded ${b.outcome} for ${learner.name} on ${v.guide.documentId}`, detail: { learnerId: b.learnerId } });
  return { id: row.id, reassessOn };
}

/** My own status per guide (a learner's view of their own records). */
export async function myTraining(ctx: Ctx) {
  const [acks, quiz, signoffs] = await Promise.all([
    prisma.acknowledgement.findMany({ where: { userId: ctx.userId }, orderBy: { at: "desc" } }),
    prisma.quizAttempt.findMany({ where: { userId: ctx.userId }, orderBy: { at: "desc" } }),
    prisma.competencySignoff.findMany({ where: { learnerId: ctx.userId }, orderBy: { signedAt: "desc" } }),
  ]);
  const guides = await prisma.guide.findMany({ where: { id: { in: [...new Set([...acks, ...quiz, ...signoffs].map((x) => x.guideId))] } }, select: { id: true, documentId: true, title: true, liveVersionId: true } });
  return guides.map((g) => ({
    ...g,
    read: acks.some((a) => a.guideId === g.id && a.kind === "READ"),
    acknowledged: acks.filter((a) => a.guideId === g.id && a.kind === "ACKNOWLEDGED").map((a) => ({ versionId: a.versionId, at: a.at, current: a.versionId === g.liveVersionId })),
    quizPassed: quiz.some((q) => q.guideId === g.id && q.passed),
    competency: signoffs.filter((s) => s.guideId === g.id).map((s) => ({ outcome: s.outcome, signedAt: s.signedAt, reassessOn: s.reassessOn, current: s.versionId === g.liveVersionId })),
  }));
}

/** Aggregate completion by guide / team / site. Counts only: no per-person ranking or scoring. */
export async function trainingReport(ctx: Ctx, opts: { guideId?: string } = {}) {
  if (!hasRole(ctx, "PROCESS_OWNER", "ADMIN", "AUDITOR", "PUBLISHER")) throw forbidden();
  const guides = await prisma.guide.findMany({ where: { AND: [guideScope(ctx), { liveVersionId: { not: null }, archivedAt: null }, opts.guideId ? { id: opts.guideId } : {}] } });
  const versions = await prisma.guideVersion.findMany({ where: { id: { in: guides.map((g) => g.liveVersionId!) } } });
  const users = await prisma.user.findMany({ where: { orgId: ctx.orgId, active: true }, include: { team: true, site: true } });
  const out = [];
  for (const g of guides) {
    const v = versions.find((x) => x.id === g.liveVersionId)!;
    const c = guideContentSchema.parse(v.content).competency;
    if (!(c.acknowledgementRequired || c.quizRequired || c.checklistRequired)) continue;
    const audience = users.filter((u) => (u.allSites || !g.siteId || u.siteIds.includes(g.siteId) || u.siteId === g.siteId) && u.roles.includes("LEARNER"));
    const [acks, quizzes, sos] = await Promise.all([
      prisma.acknowledgement.findMany({ where: { versionId: v.id, kind: "ACKNOWLEDGED" } }),
      prisma.quizAttempt.findMany({ where: { versionId: v.id, passed: true } }),
      prisma.competencySignoff.findMany({ where: { versionId: v.id, outcome: "COMPETENT" } }),
    ]);
    const by = (key: (u: (typeof users)[number]) => string) => {
      const m = new Map<string, { audience: number; acknowledged: number; competent: number }>();
      for (const u of audience) {
        const k = key(u);
        const e = m.get(k) ?? { audience: 0, acknowledged: 0, competent: 0 };
        e.audience++;
        if (acks.some((a) => a.userId === u.id)) e.acknowledged++;
        if (sos.some((s) => s.learnerId === u.id)) e.competent++;
        m.set(k, e);
      }
      return [...m].map(([name, v2]) => ({ name, ...v2 }));
    };
    out.push({
      guideId: g.id, documentId: g.documentId, title: g.title, requires: c, audience: audience.length,
      acknowledged: new Set(acks.map((a) => a.userId)).size, quizPassed: new Set(quizzes.map((q) => q.userId)).size, competent: new Set(sos.map((s) => s.learnerId)).size,
      byTeam: by((u) => u.team?.name ?? "No team"), bySite: by((u) => u.site?.name ?? "No site"),
    });
  }
  return out;
}
