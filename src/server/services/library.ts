import { z } from "zod";
import QRCode from "qrcode";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { hasRole } from "../ctx";
import { canSeeGuide, isOwnerOrAdmin } from "../authz";
import { forbidden, notFound, conflict } from "../errors";
import { env } from "../env";
import { LIVE_STATUSES } from "../../lib/roles";

async function liveGuide(ctx: Ctx, idOrDoc: string) {
  const g = await prisma.guide.findFirst({ where: { orgId: ctx.orgId, OR: [{ id: idOrDoc }, { documentId: idOrDoc }, { shortCode: idOrDoc }] } });
  if (!g || !canSeeGuide(ctx, g) || g.archivedAt || !g.liveVersionId) throw notFound("Guide");
  return g;
}

/** Aggregate view counter (no user attribution) + the viewer's own recents list. */
export async function recordView(ctx: Ctx, guideId: string, versionId: string, channel = "web") {
  await prisma.viewEvent.create({ data: { orgId: ctx.orgId, guideId, versionId, channel } });
  await prisma.recentView.upsert({ where: { userId_guideId: { userId: ctx.userId, guideId } }, create: { userId: ctx.userId, guideId }, update: { at: new Date() } });
}

export async function toggleFavourite(ctx: Ctx, idOrDoc: string) {
  const g = await liveGuide(ctx, idOrDoc);
  const key = { userId_guideId: { userId: ctx.userId, guideId: g.id } };
  const ex = await prisma.favourite.findUnique({ where: key });
  if (ex) { await prisma.favourite.delete({ where: key }); return { favourite: false }; }
  await prisma.favourite.create({ data: { userId: ctx.userId, guideId: g.id } });
  return { favourite: true };
}

const feedbackSchema = z.object({
  kind: z.enum(["RATING", "OUTDATED", "UNCLEAR", "BROKEN_LINK", "OTHER"]),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).default(""),
  stepId: z.string().max(40).optional(),
});

export async function submitFeedback(ctx: Ctx, idOrDoc: string, input: unknown) {
  const g = await liveGuide(ctx, idOrDoc);
  const f = feedbackSchema.parse(input);
  if (f.kind === "RATING" && !f.rating) throw conflict("A rating (1-5) is required");
  if (f.kind !== "RATING" && f.comment.trim().length < 3) throw conflict("Please describe the problem");
  const row = await prisma.feedback.create({ data: { orgId: ctx.orgId, guideId: g.id, versionId: g.liveVersionId!, stepId: f.stepId, userId: ctx.userId, kind: f.kind, rating: f.rating, comment: f.comment } });
  if (f.kind === "OUTDATED") {
    const { notify } = await import("./notify");
    await notify(ctx.orgId, [g.ownerId, g.backupOwnerId], "outdated_report", `Outdated-content report on ${g.documentId} "${g.title}"`, `/guides/${g.id}`);
  }
  return { id: row.id };
}

export async function listFeedback(ctx: Ctx, guideId: string) {
  const g = await prisma.guide.findFirst({ where: { id: guideId, orgId: ctx.orgId } });
  if (!g || !canSeeGuide(ctx, g) || !(isOwnerOrAdmin(ctx, g) || hasRole(ctx, "AUDITOR", "PUBLISHER", "PROCESS_OWNER"))) throw notFound("Guide");
  // Feedback is about the guide, not the person: submitter identity is deliberately not returned.
  const rows = await prisma.feedback.findMany({ where: { guideId, orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map(({ userId: _u, ...r }) => r);
}

export async function setFeedbackStatus(ctx: Ctx, id: string, status: "ACKNOWLEDGED" | "RESOLVED") {
  const f = await prisma.feedback.findFirst({ where: { id, orgId: ctx.orgId }, include: { guide: true } });
  if (!f || !isOwnerOrAdmin(ctx, f.guide)) throw forbidden();
  await prisma.feedback.update({ where: { id }, data: { status, resolvedAt: status === "RESOLVED" ? new Date() : null } });
  await audit(ctx, null, { action: "FEEDBACK_" + status, entityType: "Feedback", entityId: id, guideId: f.guideId, summary: `Feedback ${status.toLowerCase()} on ${f.guide.documentId}` });
}

export const liveUrl = (documentId: string) => `${env().APP_BASE_URL.replace(/\/$/, "")}/g/${documentId}`;
export const shortUrl = (code: string) => `${env().APP_BASE_URL.replace(/\/$/, "")}/s/${code}`;

export async function qrSvg(ctx: Ctx, idOrDoc: string) {
  const g = await liveGuide(ctx, idOrDoc);
  return QRCode.toString(shortUrl(g.shortCode), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

export async function resolveShortCode(ctx: Ctx, code: string) {
  const g = await prisma.guide.findFirst({ where: { orgId: ctx.orgId, shortCode: code } });
  if (!g || !canSeeGuide(ctx, g)) throw notFound("Guide");
  return g.documentId;
}
void LIVE_STATUSES;
