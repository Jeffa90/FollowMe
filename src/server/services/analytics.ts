// Process and product analytics. Deliberately reports on GUIDES, SEARCHES and PROCESSES only. There are no per-person
// metrics, rankings, productivity scores or performance assessments anywhere in this module (and a test asserts it).
import { prisma } from "../db";
import type { Ctx } from "../ctx";
import { hasRole } from "../ctx";
import { guideScope } from "../authz";
import { forbidden } from "../errors";
import { trainingReport } from "./training";

const DAY = 86400_000;
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export async function analytics(ctx: Ctx, opts: { days?: number } = {}) {
  if (!hasRole(ctx, "PROCESS_OWNER", "ADMIN", "AUDITOR", "PUBLISHER")) throw forbidden();
  const days = opts.days ?? 90;
  const since = new Date(Date.now() - days * DAY);
  const owned = !hasRole(ctx, "ADMIN", "AUDITOR", "PUBLISHER"); // plain process owners see their own guides
  const guides = await prisma.guide.findMany({ where: { AND: [guideScope(ctx), owned ? { OR: [{ ownerId: ctx.userId }, { backupOwnerId: ctx.userId }] } : {}] }, select: { id: true, documentId: true, title: true, liveVersionId: true, archivedAt: true } });
  const gid = guides.map((g) => g.id);
  const title = (id: string) => guides.find((g) => g.id === id)?.title ?? id;
  const doc = (id: string) => guides.find((g) => g.id === id)?.documentId ?? "";

  const [views, searches, feedback, versions, importItems, findings, unanswered, live] = await Promise.all([
    prisma.viewEvent.groupBy({ by: ["guideId"], where: { orgId: ctx.orgId, guideId: { in: gid }, at: { gte: since } }, _count: { _all: true } }),
    prisma.searchLog.findMany({ where: { orgId: ctx.orgId, at: { gte: since } }, select: { normalised: true, resultCount: true } }),
    prisma.feedback.findMany({ where: { orgId: ctx.orgId, guideId: { in: gid }, createdAt: { gte: since } }, select: { guideId: true, kind: true, rating: true, status: true } }),
    prisma.guideVersion.findMany({ where: { orgId: ctx.orgId, guideId: { in: gid } }, select: { status: true, createdAt: true, publishedAt: true, submittedAt: true, urgent: true, reviewDate: true, guideId: true } }),
    owned ? [] : prisma.importItem.findMany({ where: { orgId: ctx.orgId, createdAt: { gte: since } }, select: { status: true, conversion: true } }),
    prisma.healthFinding.findMany({ where: { orgId: ctx.orgId, guideId: { in: gid }, status: { not: "RESOLVED" } }, select: { ruleId: true, severity: true, status: true, guideId: true } }),
    owned ? [] : prisma.aiQuestion.groupBy({ by: ["question"], where: { orgId: ctx.orgId, answered: false, at: { gte: since } }, _count: { _all: true }, orderBy: { _count: { question: "desc" } }, take: 10 }),
    prisma.guideVersion.findMany({ where: { orgId: ctx.orgId, guideId: { in: gid }, status: { in: ["PUBLISHED", "UNDER_REVIEW"] } }, select: { reviewDate: true, guideId: true } }),
  ]);

  const viewTotal = views.reduce((a, v) => a + v._count._all, 0);
  const searchFailed = new Map<string, number>();
  for (const s of searches.filter((x) => x.resultCount === 0)) searchFailed.set(s.normalised, (searchFailed.get(s.normalised) ?? 0) + 1);
  const ratings = feedback.filter((f) => f.kind === "RATING" && f.rating != null);
  const byGuideRating = new Map<string, number[]>();
  for (const r of ratings) byGuideRating.set(r.guideId, [...(byGuideRating.get(r.guideId) ?? []), r.rating!]);
  const outdated = new Map<string, number>();
  for (const f of feedback.filter((x) => x.kind === "OUTDATED" && x.status === "OPEN")) outdated.set(f.guideId, (outdated.get(f.guideId) ?? 0) + 1);
  const now = Date.now();
  const cycle = versions.filter((v) => v.publishedAt && v.createdAt >= since).map((v) => (v.publishedAt!.getTime() - v.createdAt.getTime()) / DAY);
  const reviewCycle = versions.filter((v) => v.publishedAt && v.submittedAt && v.createdAt >= since).map((v) => (v.publishedAt!.getTime() - v.submittedAt!.getTime()) / DAY);
  const conv = importItems.map((i) => (i.conversion as { overallConfidence?: number } | null)?.overallConfidence).filter((x): x is number => typeof x === "number");
  const cnt = (...s: string[]) => importItems.filter((i) => s.includes(i.status)).length;
  const dupRules = new Set(findings.filter((f) => f.ruleId.startsWith("duplicate.near")).map((f) => f.guideId));

  return {
    periodDays: days,
    notice: "These figures describe guides, searches and processes. FollowMe does not rank, score or assess people.",
    usage: { views: viewTotal, topGuides: views.sort((a, b) => b._count._all - a._count._all).slice(0, 10).map((v) => ({ documentId: doc(v.guideId), title: title(v.guideId), views: v._count._all })) },
    search: { total: searches.length, successRate: searches.length ? 1 - [...searchFailed.values()].reduce((a, b) => a + b, 0) / searches.length : null, failed: [...searchFailed].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([query, count]) => ({ query, count })) },
    feedback: {
      ratings: ratings.length, averageRating: ratings.length ? ratings.reduce((a, r) => a + r.rating!, 0) / ratings.length : null,
      lowestRated: [...byGuideRating].filter(([, r]) => r.length >= 2).map(([id, r]) => ({ documentId: doc(id), title: title(id), average: r.reduce((a, b) => a + b, 0) / r.length, count: r.length })).sort((a, b) => a.average - b.average).slice(0, 5),
      outdatedReports: [...outdated].map(([id, count]) => ({ documentId: doc(id), title: title(id), open: count })).sort((a, b) => b.open - a.open),
    },
    reviews: {
      live: live.length, overdue: live.filter((v) => v.reviewDate && v.reviewDate.getTime() < now).length, dueIn30Days: live.filter((v) => v.reviewDate && v.reviewDate.getTime() >= now && v.reviewDate.getTime() < now + 30 * DAY).length,
      dueIn90Days: live.filter((v) => v.reviewDate && v.reviewDate.getTime() >= now + 30 * DAY && v.reviewDate.getTime() < now + 90 * DAY).length,
    },
    publication: { published: cycle.length, medianDaysCreateToPublish: median(cycle), medianDaysSubmitToPublish: median(reviewCycle), urgentCorrections: versions.filter((v) => v.urgent && v.publishedAt && v.createdAt >= since).length },
    pipeline: Object.fromEntries(["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "READY_FOR_APPROVAL", "APPROVED", "PUBLISHED", "UNDER_REVIEW", "SUPERSEDED"].map((s) => [s, versions.filter((v) => v.status === s).length])),
    legacy: owned ? null : { submitted: importItems.length, converted: cnt("NEEDS_REVIEW", "CONFIRMED", "DRY_RUN_OK"), confirmed: cnt("CONFIRMED"), rejected: cnt("REJECTED"), failed: cnt("FAILED"), duplicates: cnt("DUPLICATE"), acceptanceRate: cnt("CONFIRMED", "REJECTED") ? cnt("CONFIRMED") / cnt("CONFIRMED", "REJECTED") : null, meanConfidence: conv.length ? conv.reduce((a, b) => a + b, 0) / conv.length : null },
    health: { blocking: findings.filter((f) => f.severity === "BLOCKING_ERROR" && f.status === "OPEN").length, warnings: findings.filter((f) => f.severity === "WARNING" && f.status === "OPEN").length, acceptedExceptions: findings.filter((f) => f.status === "ACCEPTED_EXCEPTION").length, guidesWithNearDuplicates: dupRules.size },
    unansweredQuestions: unanswered.map((u) => ({ question: u.question, count: u._count._all })),
    training: (await trainingReport(ctx).catch(() => [])).map((t) => ({ documentId: t.documentId, title: t.title, audience: t.audience, acknowledged: t.acknowledged, quizPassed: t.quizPassed, competent: t.competent, byTeam: t.byTeam, bySite: t.bySite })),
  };
}
