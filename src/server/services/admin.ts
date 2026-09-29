import { z } from "zod";
import { prisma } from "../db";
import { audit, verifyAuditChain } from "../audit";
import type { Ctx } from "../ctx";
import { hasRole } from "../ctx";
import { forbidden, notFound, conflict } from "../errors";
import { aiPolicySchema, capturePolicySchema, retentionPolicySchema } from "../../lib/policy";
import { ROLES, CLASSIFICATIONS } from "../../lib/roles";
import { runOrgHealthScan } from "./health";

const admin = (ctx: Ctx) => { if (!hasRole(ctx, "ADMIN")) throw forbidden("Administrator only"); };

export async function listUsers(ctx: Ctx) {
  admin(ctx);
  return prisma.user.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, roles: true, active: true, clearance: true, siteId: true, teamId: true, allSites: true, siteIds: true, jobTitle: true } });
}

const userPatch = z.object({ roles: z.array(z.enum(ROLES)).min(1).optional(), active: z.boolean().optional(), clearance: z.enum(CLASSIFICATIONS).optional(), siteId: z.string().nullable().optional(), teamId: z.string().nullable().optional(), allSites: z.boolean().optional(), siteIds: z.array(z.string()).optional() });
export async function updateUser(ctx: Ctx, userId: string, input: unknown) {
  admin(ctx);
  const p = userPatch.parse(input);
  const u = await prisma.user.findFirst({ where: { id: userId, orgId: ctx.orgId } });
  if (!u) throw notFound("User");
  if (u.id === ctx.userId && (p.active === false || (p.roles && !p.roles.includes("ADMIN")))) throw conflict("You cannot remove your own administrator access or deactivate yourself");
  const data: Record<string, unknown> = { ...p };
  if (p.active === false) data.deactivatedAt = new Date(); else if (p.active === true) data.deactivatedAt = null;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data });
    if (p.active === false) { // deactivation revokes every session and API token immediately
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.apiToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(ctx, null, { action: "USER_UPDATED", entityType: "User", entityId: userId, summary: `Updated ${u.name}: ${Object.keys(p).join(", ")}`, detail: { before: { roles: u.roles, active: u.active, clearance: u.clearance }, after: p } }, tx);
  });
  if (p.active === false) await runOrgHealthScan(ctx.orgId, ctx); // surfaces orphaned guides straight away
  return { ok: true };
}

export async function getSettings(ctx: Ctx) {
  admin(ctx);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  return { name: org.name, dataRegion: org.dataRegion, legalHold: org.legalHold, aiPolicy: aiPolicySchema.parse(org.aiPolicy ?? {}), capturePolicy: capturePolicySchema.parse(org.capturePolicy ?? {}), retentionPolicy: retentionPolicySchema.parse(org.retentionPolicy ?? {}) };
}

export async function updateSettings(ctx: Ctx, input: unknown) {
  admin(ctx);
  const p = z.object({ aiPolicy: aiPolicySchema.optional(), capturePolicy: capturePolicySchema.optional(), retentionPolicy: retentionPolicySchema.optional(), legalHold: z.boolean().optional(), dataRegion: z.string().max(40).optional() }).parse(input);
  for (const r of p.capturePolicy?.redactPatterns ?? []) { try { new RegExp(r.regex); } catch { throw conflict(`Invalid redaction pattern "${r.name}"`); } }
  await prisma.organization.update({ where: { id: ctx.orgId }, data: { ...(p.aiPolicy ? { aiPolicy: p.aiPolicy as object } : {}), ...(p.capturePolicy ? { capturePolicy: p.capturePolicy as object } : {}), ...(p.retentionPolicy ? { retentionPolicy: p.retentionPolicy as object } : {}), ...(p.legalHold !== undefined ? { legalHold: p.legalHold } : {}), ...(p.dataRegion ? { dataRegion: p.dataRegion } : {}) } });
  await audit(ctx, null, { action: "SETTINGS_UPDATED", entityType: "Organization", entityId: ctx.orgId, summary: `Settings updated: ${Object.keys(p).join(", ")}`, detail: p as Record<string, unknown> });
  return { ok: true };
}

export async function listRegistry(ctx: Ctx) {
  admin(ctx);
  const [synonyms, retired, taxonomy, workflows, templates, tokens, webhooks] = await Promise.all([
    prisma.synonym.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ kind: "asc" }, { term: "asc" }] }), prisma.retiredReference.findMany({ where: { orgId: ctx.orgId } }),
    prisma.taxonomyTerm.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ kind: "asc" }, { code: "asc" }] }), prisma.workflow.findMany({ where: { orgId: ctx.orgId } }),
    prisma.template.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" } }),
    prisma.apiToken.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, name: true, scopes: true, createdAt: true, expiresAt: true, revokedAt: true, lastUsedAt: true, userId: true } }),
    prisma.webhookSubscription.findMany({ where: { orgId: ctx.orgId }, select: { id: true, url: true, events: true, active: true, createdAt: true } }),
  ]);
  return { synonyms, retired, taxonomy, workflows, templates, tokens, webhooks };
}

const regSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("synonym"), kind: z.enum(["SYNONYM", "ACRONYM"]), term: z.string().min(1).max(80), expansions: z.array(z.string().max(120)).min(1).max(10) }),
  z.object({ type: z.literal("retired"), kind: z.enum(["SYSTEM", "TCODE", "URL_PATTERN"]), value: z.string().min(1).max(120), replacement: z.string().max(120).nullable().optional(), note: z.string().max(300).default("") }),
  z.object({ type: z.literal("taxonomy"), kind: z.enum(["PROCESS", "FUNCTION", "CATEGORY", "SYSTEM", "BUSINESS_UNIT", "DEPARTMENT"]), code: z.string().min(1).max(40), label: z.string().min(1).max(120) }),
]);
export async function addRegistryEntry(ctx: Ctx, input: unknown) {
  admin(ctx);
  const e = regSchema.parse(input);
  if (e.type === "synonym") await prisma.synonym.upsert({ where: { orgId_kind_term: { orgId: ctx.orgId, kind: e.kind, term: e.term } }, create: { orgId: ctx.orgId, kind: e.kind, term: e.term, expansions: e.expansions }, update: { expansions: e.expansions } });
  else if (e.type === "retired") await prisma.retiredReference.upsert({ where: { orgId_kind_value: { orgId: ctx.orgId, kind: e.kind, value: e.value } }, create: { orgId: ctx.orgId, kind: e.kind, value: e.value, replacement: e.replacement ?? null, note: e.note }, update: { replacement: e.replacement ?? null, note: e.note } });
  else await prisma.taxonomyTerm.upsert({ where: { orgId_kind_code: { orgId: ctx.orgId, kind: e.kind, code: e.code } }, create: { orgId: ctx.orgId, kind: e.kind, code: e.code, label: e.label }, update: { label: e.label } });
  await audit(ctx, null, { action: "REGISTRY_UPDATED", entityType: e.type, entityId: e.type === "synonym" ? e.term : e.type === "retired" ? e.value : e.code, summary: `Registry entry saved (${e.type})` });
}

export async function revokeToken(ctx: Ctx, tokenId: string) {
  admin(ctx);
  const t = await prisma.apiToken.findFirst({ where: { id: tokenId, orgId: ctx.orgId } });
  if (!t) throw notFound("Token");
  await prisma.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  await audit(ctx, null, { action: "API_TOKEN_REVOKED", entityType: "ApiToken", entityId: tokenId, summary: `Revoked API token "${t.name}"` });
}

export async function updateTemplateDefinition(ctx: Ctx, templateId: string, definition: unknown) {
  admin(ctx);
  const sec = z.object({ key: z.string(), label: z.string().max(80), required: z.boolean(), enabled: z.boolean(), hint: z.string().max(200).optional() });
  const def = z.object({ sections: z.array(sec).min(1).max(40), requiredMeta: z.array(z.enum(["systems", "applications", "websites", "sapTransactions", "businessRoles", "processCode", "siteId"])), stepKinds: z.array(z.string()).min(1), defaults: z.record(z.string(), z.unknown()) }).parse(definition);
  const t = await prisma.template.findFirst({ where: { id: templateId, orgId: ctx.orgId } });
  if (!t) throw notFound("Template");
  await prisma.template.update({ where: { id: templateId }, data: { definition: def as object } });
  await audit(ctx, null, { action: "TEMPLATE_UPDATED", entityType: "Template", entityId: templateId, summary: `Template "${t.name}" updated` });
}

export async function auditLog(ctx: Ctx, opts: { guideId?: string; action?: string; take?: number } = {}) {
  if (!hasRole(ctx, "AUDITOR", "ADMIN")) throw forbidden();
  const rows = await prisma.auditEvent.findMany({ where: { orgId: ctx.orgId, ...(opts.guideId ? { guideId: opts.guideId } : {}), ...(opts.action ? { action: opts.action } : {}) }, orderBy: { seq: "desc" }, take: Math.min(opts.take ?? 200, 1000) });
  return rows;
}
export async function auditVerify(ctx: Ctx) {
  if (!hasRole(ctx, "AUDITOR", "ADMIN")) throw forbidden();
  return verifyAuditChain(ctx.orgId);
}
export async function runScanNow(ctx: Ctx) {
  if (!hasRole(ctx, "ADMIN", "PUBLISHER", "PROCESS_OWNER")) throw forbidden();
  return runOrgHealthScan(ctx.orgId, ctx);
}
