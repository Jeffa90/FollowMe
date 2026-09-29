import { prisma } from "../db";
import type { Ctx } from "../ctx";
import { hasRole } from "../ctx";
import { guideScope } from "../authz";
import { OPEN_STATUSES } from "../../lib/roles";

const DAY = 86400_000;

export async function homeData(ctx: Ctx) {
  const scope = guideScope(ctx);
  const [favs, recents, notifications] = await Promise.all([
    prisma.favourite.findMany({ where: { userId: ctx.userId }, orderBy: { at: "desc" }, take: 8 }),
    prisma.recentView.findMany({ where: { userId: ctx.userId }, orderBy: { at: "desc" }, take: 8 }),
    prisma.notification.findMany({ where: { userId: ctx.userId, readAt: null }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const ids = [...favs, ...recents].map((f) => f.guideId);
  const live = await prisma.guide.findMany({ where: { AND: [scope, { id: { in: ids }, liveVersionId: { not: null }, archivedAt: null }] }, select: { id: true, documentId: true, title: true } });
  const byId = new Map(live.map((g) => [g.id, g]));
  const out = {
    favourites: favs.map((f) => byId.get(f.guideId)).filter(Boolean) as typeof live,
    recents: recents.map((f) => byId.get(f.guideId)).filter(Boolean) as typeof live,
    notifications,
    myWork: [] as Awaited<ReturnType<typeof myWork>>,
    queue: null as Awaited<ReturnType<typeof reviewQueue>> | null,
    owner: null as Awaited<ReturnType<typeof ownerDashboard>> | null,
    acknowledgementsDue: [] as { guideId: string; documentId: string; title: string }[],
  };
  if (hasRole(ctx, "AUTHOR")) out.myWork = await myWork(ctx);
  if (hasRole(ctx, "REVIEWER", "APPROVER", "PUBLISHER")) out.queue = await reviewQueue(ctx);
  if (hasRole(ctx, "PROCESS_OWNER")) out.owner = await ownerDashboard(ctx);
  // Acknowledgements required by live guides the learner can see and has not acknowledged for the current version
  const cands = await prisma.guide.findMany({ where: { AND: [scope, { liveVersionId: { not: null }, archivedAt: null }] }, select: { id: true, documentId: true, title: true, liveVersionId: true } });
  if (cands.length) {
    const versions = await prisma.guideVersion.findMany({ where: { id: { in: cands.map((c) => c.liveVersionId!) } }, select: { id: true, content: true } });
    const req = versions.filter((v) => (v.content as { competency?: { acknowledgementRequired?: boolean } }).competency?.acknowledgementRequired).map((v) => v.id);
    const done = await prisma.acknowledgement.findMany({ where: { userId: ctx.userId, versionId: { in: req }, kind: "ACKNOWLEDGED" }, select: { versionId: true } });
    const doneSet = new Set(done.map((d) => d.versionId));
    out.acknowledgementsDue = cands.filter((c) => req.includes(c.liveVersionId!) && !doneSet.has(c.liveVersionId!)).map((c) => ({ guideId: c.id, documentId: c.documentId, title: c.title }));
  }
  return out;
}

export async function myWork(ctx: Ctx) {
  return prisma.guideVersion.findMany({
    where: { orgId: ctx.orgId, status: { in: OPEN_STATUSES }, OR: [{ authorId: ctx.userId }, { contributorIds: { has: ctx.userId } }], guide: guideScope(ctx) },
    include: { guide: { select: { id: true, documentId: true, title: true } } }, orderBy: { updatedAt: "desc" }, take: 30,
  });
}

/** Work waiting on this user's role. Segregation (own guides) is excluded so people only see what they may act on. */
export async function reviewQueue(ctx: Ctx) {
  const scope = guideScope(ctx);
  const base = { orgId: ctx.orgId, guide: scope, NOT: { OR: [{ authorId: ctx.userId }, { contributorIds: { has: ctx.userId } }] } };
  const include = { guide: { select: { id: true, documentId: true, title: true, criticality: true } } };
  const [toReview, toApprove, toPublish, published] = await Promise.all([
    hasRole(ctx, "REVIEWER") ? prisma.guideVersion.findMany({ where: { ...base, status: "IN_REVIEW" }, include, orderBy: { submittedAt: "asc" } }) : [],
    hasRole(ctx, "APPROVER") ? prisma.guideVersion.findMany({ where: { ...base, status: "READY_FOR_APPROVAL" }, include, orderBy: { submittedAt: "asc" } }) : [],
    hasRole(ctx, "PUBLISHER") ? prisma.guideVersion.findMany({ where: { orgId: ctx.orgId, guide: scope, status: "APPROVED", NOT: { authorId: ctx.userId } }, include, orderBy: { approvedAt: "asc" } }) : [],
    Promise.resolve([]),
  ]);
  void published;
  return { toReview, toApprove, toPublish };
}

export async function ownerDashboard(ctx: Ctx, opts: { all?: boolean } = {}) {
  const all = opts.all ?? hasRole(ctx, "ADMIN", "PUBLISHER", "AUDITOR");
  const guides = await prisma.guide.findMany({
    where: { AND: [guideScope(ctx), { archivedAt: null }, all ? {} : { OR: [{ ownerId: ctx.userId }, { backupOwnerId: ctx.userId }] }] },
    orderBy: { documentId: "asc" },
  });
  const versionIds = guides.map((g) => g.liveVersionId).filter((x): x is string => !!x);
  const versions = await prisma.guideVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, reviewDate: true, status: true, label: true } });
  const users = await prisma.user.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true, active: true } });
  const recs = await prisma.reviewRecommendation.findMany({ where: { orgId: ctx.orgId, guideId: { in: guides.map((g) => g.id) }, status: "OPEN" }, orderBy: { createdAt: "desc" } });
  const now = Date.now();
  const rows = guides.map((g) => {
    const v = versions.find((x) => x.id === g.liveVersionId);
    const owner = users.find((u) => u.id === g.ownerId);
    const backup = users.find((u) => u.id === g.backupOwnerId);
    const days = v?.reviewDate ? Math.floor((v.reviewDate.getTime() - now) / DAY) : null;
    return {
      id: g.id, documentId: g.documentId, title: g.title, ownerName: owner?.name ?? null, ownerActive: owner?.active ?? false, backupName: backup?.name ?? null,
      reviewDate: v?.reviewDate ?? null, daysToReview: days, status: v?.status ?? "DRAFT", live: !!v, orphaned: !!g.liveVersionId && !owner?.active,
      openRecs: recs.filter((r) => r.guideId === g.id),
    };
  });
  return {
    rows,
    overdue: rows.filter((r) => r.live && r.daysToReview !== null && r.daysToReview < 0),
    dueSoon: rows.filter((r) => r.live && r.daysToReview !== null && r.daysToReview >= 0 && r.daysToReview <= 30),
    orphaned: rows.filter((r) => r.orphaned),
    recommendations: recs.map((r) => ({ ...r, guide: guides.find((g) => g.id === r.guideId)! })),
  };
}

export async function libraryFacets(ctx: Ctx) {
  const guides = await prisma.guide.findMany({ where: { AND: [guideScope(ctx), { liveVersionId: { not: null }, archivedAt: null }] }, select: { siteId: true, processCode: true, ownerId: true, systems: true, categories: true } });
  const [sites, owners] = await Promise.all([
    prisma.site.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
  ]);
  const uniq = <T,>(a: T[]) => [...new Set(a)].sort();
  return {
    sites: sites.filter((s) => guides.some((g) => g.siteId === s.id)),
    processes: uniq(guides.map((g) => g.processCode).filter((x): x is string => !!x)),
    owners: owners.filter((o) => guides.some((g) => g.ownerId === o.id)),
    systems: uniq(guides.flatMap((g) => g.systems)),
    categories: uniq(guides.flatMap((g) => g.categories)),
  };
}
