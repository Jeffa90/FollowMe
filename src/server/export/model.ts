// Exports are GENERATED REPRESENTATIONS of the governed source, never editable masters.
import QRCode from "qrcode";
import sharp from "sharp";
import type { Ctx } from "../ctx";
import { prisma } from "../db";
import { loadVersion } from "../services/guides";
import { renderImageForExport } from "../services/assets";
import { guideContentSchema, flattenSteps, type GuideContent, type Step } from "../../lib/guide-schema";
import { liveUrl, shortUrl } from "../services/library";
import { hasRole } from "../ctx";
import { forbidden } from "../errors";
import { LIVE_STATUSES } from "../../lib/roles";
import { canEditContent } from "../authz";

export interface ControlBlock {
  documentId: string; title: string; versionLabel: string; versionNumber: number; status: string; isDraft: boolean;
  publishedAt: string | null; effectiveDate: string | null; reviewDate: string | null; exportedAt: string; exportedBy: string;
  owner: string | null; site: string | null; classification: string; sourceUrl: string; shortUrl: string; contentHash: string;
  warning: string; marker: string;
}
export interface ExportModel { control: ControlBlock; content: GuideContent; images: Map<string, { png: Buffer; width: number; height: number }>; qr: Buffer; orgId: string; guideId: string; versionId: string }

const d = (x: Date | string | null | undefined) => (x ? new Date(x).toISOString().slice(0, 10) : null);

export async function buildExportModel(ctx: Ctx, versionId: string): Promise<ExportModel> {
  const v = await loadVersion(ctx, versionId);
  const live = LIVE_STATUSES.includes(v.status as never);
  const superseded = v.status === "SUPERSEDED" || v.status === "ARCHIVED";
  if (!live && !superseded && !(canEditContent(ctx, v.guide) || hasRole(ctx, "REVIEWER", "APPROVER", "PUBLISHER", "PROCESS_OWNER", "ADMIN", "AUDITOR"))) throw forbidden("Only published versions can be exported");
  const content = guideContentSchema.parse(v.content);
  const [owner, site] = await Promise.all([
    v.guide.ownerId ? prisma.user.findUnique({ where: { id: v.guide.ownerId }, select: { name: true } }) : null,
    v.guide.siteId ? prisma.site.findUnique({ where: { id: v.guide.siteId } }) : null,
  ]);
  const snap = (v.controlSnapshot ?? {}) as { owner?: string; site?: string };
  const exportedAt = new Date().toISOString();
  const url = liveUrl(v.guide.documentId);
  const warning = live
    ? "UNCONTROLLED WHEN PRINTED OR DOWNLOADED. This is a generated copy of a controlled document. Check the live source for the current version before use."
    : superseded
      ? "SUPERSEDED VERSION: DO NOT USE FOR WORK. Provided for audit only. The current version is at the live source."
      : "DRAFT: NOT APPROVED. Not for use. This copy is not a controlled document.";
  const control: ControlBlock = {
    documentId: v.guide.documentId, title: content.title, versionLabel: v.label, versionNumber: v.number, status: v.status, isDraft: !live && !superseded,
    publishedAt: d(v.publishedAt), effectiveDate: d(v.effectiveDate), reviewDate: d(v.reviewDate), exportedAt, exportedBy: ctx.name,
    owner: snap.owner ?? owner?.name ?? null, site: snap.site ?? site?.name ?? null, classification: v.guide.classification, sourceUrl: url, shortUrl: shortUrl(v.guide.shortCode), contentHash: v.contentHash, warning,
    marker: `FOLLOWME-CONTROL ${v.guide.documentId} v${v.label} ${v.contentHash.slice(0, 12)}`,
  };
  const images = new Map<string, { png: Buffer; width: number; height: number }>();
  for (const s of flattenSteps(content.steps)) {
    if (!s.image) continue;
    try {
      const png = await renderImageForExport(ctx.orgId, s.image, 1100);
      const m = await sharp(png).metadata();
      images.set(s.id, { png, width: m.width ?? 800, height: m.height ?? 500 });
    } catch { /* missing image: export continues; health check reports it */ }
  }
  const qr = await QRCode.toBuffer(url, { margin: 1, width: 160, errorCorrectionLevel: "M" });
  return { control, content, images, qr, orgId: ctx.orgId, guideId: v.guideId, versionId };
}

/** Flat list of (number, step, depth) in reading order for renderers. */
export type { Step };
