// Central authorisation rules. Services call these; no route trusts client-supplied role or org data.
import type { Prisma } from "../generated/prisma/client";
import { Ctx, hasRole } from "./ctx";
import { CLASSIFICATIONS, LIVE_STATUSES, clearanceAllows, type GuideStatus } from "../lib/roles";
import { forbidden, notFound } from "./errors";

export const allowedClassifications = (ctx: Ctx) => CLASSIFICATIONS.filter((c) => clearanceAllows(ctx.clearance, c));

export const siteVisible = (ctx: Ctx, siteId: string | null | undefined) =>
  ctx.allSites || !siteId || ctx.siteIds.includes(siteId) || ctx.siteId === siteId;

/** Prisma filter: guides the caller may see at all (org, clearance and site isolation). */
export function guideScope(ctx: Ctx): Prisma.GuideWhereInput {
  const and: Prisma.GuideWhereInput[] = [{ orgId: ctx.orgId }, { classification: { in: allowedClassifications(ctx) } }];
  if (!ctx.allSites) and.push({ OR: [{ siteId: null }, { siteId: { in: [...ctx.siteIds, ...(ctx.siteId ? [ctx.siteId] : [])] } }] });
  return { AND: and };
}

export interface GuideLike {
  orgId: string;
  siteId: string | null;
  classification: string;
  ownerId: string | null;
  backupOwnerId: string | null;
}

export function canSeeGuide(ctx: Ctx, g: GuideLike): boolean {
  return g.orgId === ctx.orgId && clearanceAllows(ctx.clearance, g.classification as never) && siteVisible(ctx, g.siteId);
}

const WORKING_READERS = ["AUTHOR", "PROCESS_OWNER", "REVIEWER", "APPROVER", "PUBLISHER", "ADMIN", "AUDITOR"] as const;
const HISTORY_READERS = ["AUDITOR", "ADMIN", "PUBLISHER", "PROCESS_OWNER"] as const;

/** May the caller read this specific version's content? Live versions: anyone who can see the guide. */
export function canReadVersion(ctx: Ctx, g: GuideLike, status: GuideStatus): boolean {
  if (!canSeeGuide(ctx, g)) return false;
  if (LIVE_STATUSES.includes(status)) return true;
  if (status === "SUPERSEDED" || status === "ARCHIVED") return hasRole(ctx, ...HISTORY_READERS) || g.ownerId === ctx.userId || g.backupOwnerId === ctx.userId;
  return hasRole(ctx, ...WORKING_READERS);
}

export function assertReadVersion(ctx: Ctx, g: GuideLike, status: GuideStatus) {
  if (!canReadVersion(ctx, g, status)) throw notFound("Guide");
}

export function canEditContent(ctx: Ctx, g: GuideLike): boolean {
  return canSeeGuide(ctx, g) && hasRole(ctx, "AUTHOR");
}

export function isOwnerOrAdmin(ctx: Ctx, g: GuideLike): boolean {
  return hasRole(ctx, "ADMIN") || g.ownerId === ctx.userId || g.backupOwnerId === ctx.userId;
}

export function requireRoles(ctx: Ctx, ...roles: Parameters<typeof hasRole>[1][]) {
  if (!hasRole(ctx, ...(roles as never[]))) throw forbidden(`Requires one of: ${roles.join(", ")}`);
}
