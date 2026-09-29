// End-to-end process maps: assemble task guides into a governed process with triggers, inputs/outputs, roles, handoffs,
// decisions, exceptions, controls and related guides, policies and forms. (Compact MVP: structured editing and a readable
// linked view; no graphical diagram. See docs/known-limitations.md.)
import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { hasRole } from "../ctx";
import { forbidden, notFound, conflict, unprocessable } from "../errors";
import { mapContentSchema, validateMap, type MapContent } from "../../lib/process-map";
import { canSeeGuide } from "../authz";

const canEdit = (ctx: Ctx) => hasRole(ctx, "AUTHOR", "PROCESS_OWNER");

export async function createMap(ctx: Ctx, input: unknown) {
  if (!canEdit(ctx)) throw forbidden();
  const b = z.object({ title: z.string().min(2).max(200), content: mapContentSchema.optional() }).parse(input);
  const m = await prisma.processMap.create({ data: { orgId: ctx.orgId, title: b.title, ownerId: ctx.userId, content: (b.content ?? mapContentSchema.parse({})) as object } });
  await audit(ctx, null, { action: "MAP_CREATED", entityType: "ProcessMap", entityId: m.id, summary: `Created process map "${b.title}"` });
  return m;
}

export async function updateMap(ctx: Ctx, id: string, input: unknown) {
  const m = await prisma.processMap.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!m) throw notFound("Process map");
  if (!(canEdit(ctx) && (m.ownerId === ctx.userId || hasRole(ctx, "PROCESS_OWNER", "ADMIN") || hasRole(ctx, "AUTHOR")))) throw forbidden();
  if (m.status !== "DRAFT") throw conflict("Published maps are immutable; create a new draft");
  const b = z.object({ title: z.string().min(2).max(200).optional(), content: mapContentSchema }).parse(input);
  await prisma.processMap.update({ where: { id }, data: { title: b.title ?? m.title, content: b.content as object } });
  await audit(ctx, null, { action: "MAP_UPDATED", entityType: "ProcessMap", entityId: id, summary: `Edited process map "${m.title}"` });
}

export async function publishMap(ctx: Ctx, id: string) {
  if (!hasRole(ctx, "PROCESS_OWNER", "ADMIN")) throw forbidden("Only process owners or administrators publish process maps");
  const m = await prisma.processMap.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!m) throw notFound("Process map");
  if (m.status !== "DRAFT") throw conflict("Already published");
  if (m.ownerId === ctx.userId && !hasRole(ctx, "ADMIN")) { /* owners may publish their own map: maps are assemblies of already-approved guides */ }
  const c = mapContentSchema.parse(m.content);
  const problems = validateMap(c);
  const docIds = c.nodes.map((n) => n.guideDocumentId).filter((x): x is string => !!x);
  const live = await prisma.guide.findMany({ where: { orgId: ctx.orgId, documentId: { in: docIds }, liveVersionId: { not: null }, archivedAt: null }, select: { documentId: true } });
  for (const d of docIds) if (!live.some((g) => g.documentId === d)) problems.push(`Referenced guide ${d} is not currently published.`);
  if (problems.length) throw unprocessable("The map cannot be published yet", problems);
  await prisma.processMap.update({ where: { id }, data: { status: "PUBLISHED" } });
  await audit(ctx, null, { action: "MAP_PUBLISHED", entityType: "ProcessMap", entityId: id, summary: `Published process map "${m.title}"` });
}

export async function listMaps(ctx: Ctx) {
  const all = await prisma.processMap.findMany({ where: { orgId: ctx.orgId }, orderBy: { updatedAt: "desc" } });
  return all.filter((m) => m.status === "PUBLISHED" || canEdit(ctx) || hasRole(ctx, "ADMIN", "AUDITOR"));
}

/** A map with its guide references resolved against what THIS user may see; unavailable/retired references are flagged. */
export async function getMap(ctx: Ctx, id: string) {
  const m = await prisma.processMap.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!m || (m.status !== "PUBLISHED" && !(canEdit(ctx) || hasRole(ctx, "ADMIN", "AUDITOR")))) throw notFound("Process map");
  const content = mapContentSchema.parse(m.content) as MapContent;
  const docIds = content.nodes.map((n) => n.guideDocumentId).filter((x): x is string => !!x);
  const guides = await prisma.guide.findMany({ where: { orgId: ctx.orgId, documentId: { in: docIds } } });
  const refs = Object.fromEntries(docIds.map((d) => { const g = guides.find((x) => x.documentId === d); const ok = g && canSeeGuide(ctx, g) && g.liveVersionId && !g.archivedAt; return [d, ok ? { title: g!.title, available: true } : { title: d, available: false }]; }));
  return { map: m, content, refs, problems: validateMap(content) };
}
