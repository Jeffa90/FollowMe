// Search index (PostgreSQL full-text) for LIVE versions only. Drafts are never indexed, so they cannot surface in
// normal end-user search or AI retrieval. Query-time permission filtering (org, clearance, site) is applied in SQL.
import { Prisma } from "../../generated/prisma/client";
import { prisma, Db } from "../db";
import type { Ctx } from "../ctx";
import { allowedClassifications } from "../authz";
import { guideContentSchema, numberSteps, stepPlainText, stripInline } from "../../lib/guide-schema";
import { forbidden } from "../errors";

export async function reindexGuide(guideId: string, db: Db = prisma) {
  await db.searchChunk.deleteMany({ where: { guideId } });
  const g = await db.guide.findUnique({ where: { id: guideId } });
  if (!g?.liveVersionId || g.archivedAt) return;
  const v = await db.guideVersion.findUnique({ where: { id: g.liveVersionId } });
  if (!v || !["PUBLISHED", "UNDER_REVIEW"].includes(v.status)) return;
  const c = guideContentSchema.parse(v.content);
  const meta = [g.documentId, g.businessUnit, g.department, g.processCode, g.functionCode, ...g.categories, ...g.systems, ...g.applications, ...g.sapTransactions, ...g.businessRoles, ...g.websites]
    .filter(Boolean)
    .join(" ");
  const base = { orgId: g.orgId, guideId: g.id, versionId: v.id };
  const rows: Prisma.SearchChunkCreateManyInput[] = [
    { ...base, kind: "META", title: c.title, text: [c.purpose, c.scope, c.audience, meta].filter(Boolean).join(". ") },
  ];
  const section = [...c.prerequisites, ...c.permissions, ...c.hazards, c.expectedResult, ...c.validationChecks, ...c.troubleshooting.map((t) => `${t.problem} ${t.resolution}`), ...c.acronyms.map((a) => `${a.term} ${a.expansion}`)]
    .filter(Boolean).join(". ");
  if (section) rows.push({ ...base, kind: "SECTION", title: c.title, text: stripInline(section) });
  for (const n of numberSteps(c.steps)) {
    const text = stepPlainText(n.step);
    if (!text) continue;
    rows.push({ ...base, kind: "STEP", stepId: n.step.id, title: n.step.title || c.title, text });
  }
  await db.searchChunk.createMany({ data: rows });
}

export async function removeFromIndex(guideId: string, db: Db = prisma) {
  await db.searchChunk.deleteMany({ where: { guideId } });
}

const clean = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

async function synonymGroups(orgId: string, terms: string[]): Promise<string[][]> {
  const syn = await prisma.synonym.findMany({ where: { orgId } });
  return terms.map((t) => {
    const alts = new Set<string>();
    for (const s of syn) {
      const group = [s.term, ...s.expansions].map((x) => x.toLowerCase());
      if (group.includes(t)) for (const g of group) if (g !== t) alts.add(g);
    }
    return [t, ...alts];
  });
}

function tsQueryFrom(groups: string[][], op: "&" | "|"): string {
  const parts = groups.map((alts) => {
    const forms = alts
      .map((a, i) => {
        const words = a.split(/\s+/).map(clean).filter(Boolean);
        if (!words.length) return "";
        // prefix-match only the user's own last word form
        return words.map((w, j) => (i === 0 && j === words.length - 1 && words.length === 1 ? `${w}:*` : w)).join(" <-> ");
      })
      .filter(Boolean);
    return forms.length ? "(" + forms.join(" | ") + ")" : "";
  }).filter(Boolean);
  return parts.join(` ${op} `);
}

export interface SearchFilters {
  siteId?: string; processCode?: string; ownerId?: string; system?: string; category?: string;
  status?: "PUBLISHED" | "UNDER_REVIEW"; reviewBefore?: string; reviewAfter?: string;
}
export interface SearchHit {
  guideId: string; documentId: string; title: string; versionId: string; versionLabel: string; status: string;
  snippet: string; stepId: string | null; rank: number; siteName: string | null; ownerName: string | null;
  reviewDate: string | null; systems: string[]; processCode: string | null; classification: string;
}

export async function searchLibrary(ctx: Ctx, q: string, filters: SearchFilters = {}, limit = 30, log = true): Promise<{ hits: SearchHit[]; relaxed: boolean; expanded: string[] }> {
  const terms = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0).slice(0, 12);
  if (!terms.length) return { hits: [], relaxed: false, expanded: [] };
  const groups = await synonymGroups(ctx.orgId, terms);
  const expanded = groups.flatMap((g) => g.slice(1));

  const cls = allowedClassifications(ctx);
  const conds: Prisma.Sql[] = [
    Prisma.sql`g."orgId" = ${ctx.orgId}`,
    Prisma.sql`g."archivedAt" IS NULL`,
    Prisma.sql`g."liveVersionId" = c."versionId"`,
    Prisma.sql`g."classification"::text = ANY(${cls as string[]})`,
  ];
  if (!ctx.allSites) conds.push(Prisma.sql`(g."siteId" IS NULL OR g."siteId" = ANY(${[...ctx.siteIds, ...(ctx.siteId ? [ctx.siteId] : [])]}))`);
  if (filters.siteId) conds.push(Prisma.sql`g."siteId" = ${filters.siteId}`);
  if (filters.processCode) conds.push(Prisma.sql`g."processCode" = ${filters.processCode}`);
  if (filters.ownerId) conds.push(Prisma.sql`g."ownerId" = ${filters.ownerId}`);
  if (filters.system) conds.push(Prisma.sql`${filters.system} = ANY(g."systems")`);
  if (filters.category) conds.push(Prisma.sql`${filters.category} = ANY(g."categories")`);
  if (filters.status) conds.push(Prisma.sql`v."status"::text = ${filters.status}`);
  if (filters.reviewBefore) conds.push(Prisma.sql`v."reviewDate" <= ${new Date(filters.reviewBefore)}`);
  if (filters.reviewAfter) conds.push(Prisma.sql`v."reviewDate" >= ${new Date(filters.reviewAfter)}`);

  const run = async (op: "&" | "|") => {
    const tsq = tsQueryFrom(groups, op);
    if (!tsq) return [];
    return prisma.$queryRaw<{ guideId: string; versionId: string; stepId: string | null; rank: number; snippet: string }[]>(Prisma.sql`
      SELECT DISTINCT ON (c."guideId") c."guideId", c."versionId", c."stepId",
        ts_rank_cd(c."tsv", query) AS rank,
        ts_headline('english', c."text", query, 'StartSel=[[, StopSel=]], MaxFragments=1, MaxWords=28, MinWords=8') AS snippet
      FROM "SearchChunk" c
      JOIN "Guide" g ON g."id" = c."guideId"
      JOIN "GuideVersion" v ON v."id" = c."versionId",
      to_tsquery('english', ${tsq}) query
      WHERE c."tsv" @@ query AND ${Prisma.join(conds, " AND ")}
      ORDER BY c."guideId", ts_rank_cd(c."tsv", query) DESC
    `);
  };
  let rows = await run("&");
  let relaxed = false;
  if (!rows.length && terms.length > 1) {
    rows = await run("|");
    relaxed = rows.length > 0;
  }
  rows.sort((a, b) => b.rank - a.rank);
  rows = rows.slice(0, limit);

  const guides = await prisma.guide.findMany({
    where: { id: { in: rows.map((r) => r.guideId) } },
    include: { site: true },
  });
  const versions = await prisma.guideVersion.findMany({ where: { id: { in: rows.map((r) => r.versionId) } }, select: { id: true, label: true, status: true, reviewDate: true } });
  const owners = await prisma.user.findMany({ where: { id: { in: guides.map((g) => g.ownerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });

  const hits: SearchHit[] = rows.map((r) => {
    const g = guides.find((x) => x.id === r.guideId)!;
    const v = versions.find((x) => x.id === r.versionId)!;
    return {
      guideId: g.id, documentId: g.documentId, title: g.title, versionId: v.id, versionLabel: v.label, status: v.status,
      snippet: r.snippet, stepId: r.stepId, rank: r.rank, siteName: g.site?.name ?? null,
      ownerName: owners.find((o) => o.id === g.ownerId)?.name ?? null, reviewDate: v.reviewDate?.toISOString() ?? null,
      systems: g.systems, processCode: g.processCode, classification: g.classification,
    };
  });
  if (log) await prisma.searchLog.create({ data: { orgId: ctx.orgId, query: q.slice(0, 200), normalised: terms.join(" "), resultCount: hits.length, filters: filters as object } });
  return { hits, relaxed, expanded };
}

/** Application-aware suggestions (future side panel): match the current URL / SAP transaction to guide associations. */
export async function suggestForContext(ctx: Ctx, input: { url?: string; sapTransaction?: string; application?: string }) {
  if (!input.url && !input.sapTransaction && !input.application) throw forbidden("No context supplied");
  const cls = allowedClassifications(ctx);
  const guides = await prisma.guide.findMany({
    where: { orgId: ctx.orgId, liveVersionId: { not: null }, archivedAt: null, classification: { in: cls } },
    select: { id: true, documentId: true, title: true, websites: true, urlPatterns: true, sapTransactions: true, applications: true, businessRoles: true, siteId: true, classification: true, ownerId: true, backupOwnerId: true, orgId: true },
  });
  let host = "", href = "";
  try { const u = new URL(input.url ?? ""); host = u.host.toLowerCase(); href = u.href; } catch { /* no url */ }
  const globToRe = (g: string) => new RegExp("^" + g.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  const out: { documentId: string; title: string; reason: string }[] = [];
  for (const g of guides) {
    if (!ctx.allSites && g.siteId && ![...ctx.siteIds, ctx.siteId].includes(g.siteId)) continue;
    let reason = "";
    if (href && g.urlPatterns.some((p) => globToRe(p).test(href))) reason = "URL pattern match";
    else if (host && g.websites.some((w) => host === w.toLowerCase() || host.endsWith("." + w.toLowerCase()))) reason = "Website match";
    else if (input.sapTransaction && g.sapTransactions.map((t) => t.toUpperCase()).includes(input.sapTransaction.toUpperCase())) reason = "SAP transaction match";
    else if (input.application && g.applications.some((a) => a.toLowerCase() === input.application!.toLowerCase())) reason = "Application match";
    if (reason) out.push({ documentId: g.documentId, title: g.title, reason });
  }
  return out;
}
