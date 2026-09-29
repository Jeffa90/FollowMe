import { prisma } from "../db";
import { blobStore } from "../storage";
import { validateUpload, type DetectedKind } from "../upload-validation";
import { sha256 } from "../hash";
import { annotationsHash, cropImage, imageInfo, renderAnnotated } from "../imaging";
import type { Ctx } from "../ctx";
import { hasRole } from "../ctx";
import { forbidden, notFound, badRequest } from "../errors";
import { canSeeGuide, isOwnerOrAdmin } from "../authz";
import { loadVersion } from "./guides";
import { guideContentSchema, flattenSteps } from "../../lib/guide-schema";
import { audit } from "../audit";
import type { AssetPurpose } from "../../generated/prisma/client";

export const IMAGE_KINDS: DetectedKind[] = ["png", "jpeg", "webp", "gif"];
export const DOC_KINDS: DetectedKind[] = ["pdf", "docx", "pptx", "html", "markdown", "text"];

export interface StoreInput {
  buffer: Buffer; filename: string; purpose: AssetPurpose; allow: DetectedKind[];
  guideId?: string; captureSessionId?: string; importItemId?: string;
}

/** Validate (magic bytes, size, macros, malware), hash, store (encrypted if configured) and record. Content-addressed and immutable. */
export async function storeAsset(ctx: Pick<Ctx, "orgId" | "userId">, input: StoreInput) {
  const v = await validateUpload(input.buffer, input.filename, { allow: input.allow });
  const hash = sha256(input.buffer);
  const key = `${ctx.orgId}/${hash.slice(0, 2)}/${hash}`;
  await blobStore().put(key, input.buffer);
  const dims = IMAGE_KINDS.includes(v.kind) ? await imageInfo(input.buffer) : { width: null, height: null };
  return prisma.asset.create({
    data: {
      orgId: ctx.orgId, sha256: hash, mime: v.mime, size: input.buffer.length, storageKey: key, originalName: input.filename.replace(/[^\w.\- ]+/g, "_").slice(0, 200),
      purpose: input.purpose, width: dims.width, height: dims.height, createdById: ctx.userId, guideId: input.guideId, captureSessionId: input.captureSessionId, importItemId: input.importItemId,
    },
  });
}

export async function assetBuffer(orgId: string, assetId: string) {
  const a = await prisma.asset.findFirst({ where: { id: assetId, orgId } });
  if (!a) throw notFound("File");
  return { asset: a, buffer: await blobStore().get(a.storageKey) };
}

async function canReadAssetRaw(ctx: Ctx, a: { orgId: string; purpose: string; createdById: string | null; guideId: string | null; id: string }) {
  if (a.orgId !== ctx.orgId) return false;
  if (a.createdById === ctx.userId || hasRole(ctx, "AUDITOR", "ADMIN")) return true;
  const guide = a.guideId ? await prisma.guide.findUnique({ where: { id: a.guideId } }) : null;
  if (guide && !canSeeGuide(ctx, guide)) return false;
  if (a.purpose === "EVIDENCE" || a.purpose === "IMPORT_SOURCE" || a.purpose === "IMPORT_IMAGE") return !!guide && isOwnerOrAdmin(ctx, guide);
  if (a.purpose === "CONTENT") return !!guide && hasRole(ctx, "AUTHOR", "PROCESS_OWNER", "REVIEWER", "APPROVER", "PUBLISHER");
  if (a.purpose === "ATTACHMENT") {
    if (!guide) return false;
    if (hasRole(ctx, "AUTHOR", "PROCESS_OWNER", "REVIEWER", "APPROVER", "PUBLISHER")) return true;
    if (!guide.liveVersionId) return false;
    const live = await prisma.guideVersion.findUnique({ where: { id: guide.liveVersionId } });
    return !!live && guideContentSchema.parse(live.content).attachments.some((x) => x.assetId === a.id);
  }
  return false;
}

/** Raw file download. Screenshots for learners go through renderStepImage (redaction is burned in there). */
export async function readAsset(ctx: Ctx, assetId: string) {
  const a = await prisma.asset.findFirst({ where: { id: assetId, orgId: ctx.orgId } });
  if (!a || !(await canReadAssetRaw(ctx, a))) throw notFound("File");
  return { asset: a, buffer: await blobStore().get(a.storageKey) };
}

const cache = new Map<string, Buffer>();
export async function renderStepImage(ctx: Ctx, versionId: string, stepId: string, opts: { maxWidth?: number } = {}) {
  const v = await loadVersion(ctx, versionId);
  const step = flattenSteps(guideContentSchema.parse(v.content).steps).find((s) => s.id === stepId);
  if (!step?.image) throw notFound("Image");
  const { asset, buffer } = await assetBuffer(ctx.orgId, step.image.assetId);
  const key = `${asset.id}:${annotationsHash(step.image.annotations)}:${opts.maxWidth ?? 0}`;
  let out = cache.get(key);
  if (!out) {
    out = await renderAnnotated(buffer, step.image.annotations, opts);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    cache.set(key, out);
  }
  return { png: out, etag: `"${key}"` };
}

/** Internal render for exports (no request context; caller has already authorised the version). */
export async function renderImageForExport(orgId: string, image: { assetId: string; annotations: import("../../lib/guide-schema").Annotation[] }, maxWidth = 1200) {
  const { asset, buffer } = await assetBuffer(orgId, image.assetId);
  const key = `${asset.id}:${annotationsHash(image.annotations)}:${maxWidth}`;
  let out = cache.get(key);
  if (!out) {
    out = await renderAnnotated(buffer, image.annotations, { maxWidth });
    cache.set(key, out);
  }
  return out;
}

/** Crop creates a NEW asset; the original (evidence) is untouched. */
export async function cropAsset(ctx: Ctx, assetId: string, rect: { x: number; y: number; w: number; h: number }, guideId?: string) {
  if (!hasRole(ctx, "AUTHOR")) throw forbidden();
  const src = await readAsset(ctx, assetId);
  if (![rect.x, rect.y, rect.w, rect.h].every((n) => typeof n === "number" && n >= 0 && n <= 1) || rect.w <= 0 || rect.h <= 0) throw badRequest("Invalid crop rectangle");
  const { buf } = await cropImage(src.buffer, rect);
  const a = await storeAsset(ctx, { buffer: buf, filename: `crop-${src.asset.originalName.replace(/\.\w+$/, "")}.png`, purpose: "CONTENT", allow: ["png"], guideId: guideId ?? src.asset.guideId ?? undefined });
  await audit(ctx, null, { action: "IMAGE_CROPPED", entityType: "Asset", entityId: a.id, guideId: a.guideId, summary: `Cropped image ${assetId} -> ${a.id}`, detail: { rect, source: assetId } });
  return a;
}

/** Content-addressed copy: a new CONTENT asset row pointing at the same immutable blob as an evidence asset. Editing never touches evidence. */
export async function copyAssetAsContent(ctx: Pick<Ctx, "orgId" | "userId">, srcAssetId: string, guideId: string) {
  const ev = await prisma.asset.findFirst({ where: { id: srcAssetId, orgId: ctx.orgId } });
  if (!ev) throw notFound("File");
  const copy = await prisma.asset.create({ data: { orgId: ev.orgId, sha256: ev.sha256, mime: ev.mime, size: ev.size, storageKey: ev.storageKey, originalName: ev.originalName, purpose: "CONTENT", width: ev.width, height: ev.height, createdById: ctx.userId, guideId, captureSessionId: ev.captureSessionId, importItemId: ev.importItemId } });
  if (!ev.guideId) await prisma.asset.update({ where: { id: ev.id }, data: { guideId } });
  return copy;
}
