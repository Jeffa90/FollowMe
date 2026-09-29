// Legacy work-instruction redevelopment: individual and batch import, structured conversion, human confirmation.
// Originals are stored as immutable evidence and are never deleted or overwritten. Imported content is untrusted until confirmed.
import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { hasRole } from "../ctx";
import { forbidden, notFound, conflict, unprocessable } from "../errors";
import { registerJob, enqueue } from "../jobs";
import { storeAsset, assetBuffer, copyAssetAsContent, IMAGE_KINDS, DOC_KINDS } from "./assets";
import { extractDocument } from "../import/extract";
import { convertToGuide } from "../import/convert";
import type { ConversionResult } from "../import/convert";
import type { ExtractedDocument } from "../import/types";
import { createGuide, getVersionDetail, saveContent, discardDraft } from "./guides";
import { ctxForUserId } from "../session";
import { compareContent, similarity } from "../../lib/compare";
import { flattenSteps, guideContentSchema, stepPlainText, type GuideContent } from "../../lib/guide-schema";
import type { DetectedKind } from "../upload-validation";
import { guideScope } from "../authz";

export const IMPORT_KINDS: DetectedKind[] = [...DOC_KINDS, ...IMAGE_KINDS];
const kindFromMime = (mime: string): DetectedKind => (({ "application/pdf": "pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx", "text/html": "html", "text/markdown": "markdown", "text/plain": "text", "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp", "image/gif": "gif" }) as Record<string, DetectedKind>)[mime];

function assertImporter(ctx: Ctx) {
  if (!hasRole(ctx, "AUTHOR")) throw forbidden("Only authors can import documents");
}

export async function createImports(ctx: Ctx, files: { name: string; buffer: Buffer }[], opts: { batchName?: string; dryRun?: boolean; templateKey?: string } = {}) {
  assertImporter(ctx);
  if (!files.length) throw unprocessable("No files supplied");
  if (files.length > 500) throw unprocessable("A batch is limited to 500 files");
  const batch = await prisma.importBatch.create({ data: { orgId: ctx.orgId, name: opts.batchName?.slice(0, 120) || `Import ${new Date().toISOString().slice(0, 16)}`, createdById: ctx.userId, dryRun: !!opts.dryRun, source: files.length > 1 ? "BATCH_UPLOAD" : "UPLOAD" } });
  const results: { id: string; filename: string; status: string; error?: string }[] = [];
  for (const f of files) {
    try {
      const asset = await storeAsset(ctx, { buffer: f.buffer, filename: f.name, purpose: "IMPORT_SOURCE", allow: IMPORT_KINDS });
      const dup = await prisma.importItem.findFirst({ where: { orgId: ctx.orgId, sha256: asset.sha256, status: { notIn: ["FAILED", "REJECTED"] }, id: { not: undefined } }, orderBy: { createdAt: "asc" } });
      const item = await prisma.importItem.create({ data: { orgId: ctx.orgId, batchId: batch.id, createdById: ctx.userId, filename: asset.originalName, mime: asset.mime, size: asset.size, sha256: asset.sha256, sourceAssetId: asset.id, status: dup ? "DUPLICATE" : "QUEUED", duplicateOfId: dup?.id, warnings: dup ? [{ code: "exact-duplicate", message: `Identical file already imported (${dup.filename}).` }] : [], groupKeys: { template: opts.templateKey ?? null } } });
      if (!dup) await enqueue("import.process", { itemId: item.id }, { orgId: ctx.orgId });
      results.push({ id: item.id, filename: item.filename, status: item.status });
    } catch (e) {
      // Rejected at the door (bad type, malware, macro, size...). Recorded so the batch reconciles; no source stored.
      const msg = e instanceof Error ? e.message : String(e);
      const item = await prisma.importItem.create({ data: { orgId: ctx.orgId, batchId: batch.id, createdById: ctx.userId, filename: f.name.slice(0, 200), mime: "unknown", size: f.buffer.length, sha256: "rejected", sourceAssetId: "", status: "REJECTED", error: msg.slice(0, 500) } });
      results.push({ id: item.id, filename: f.name, status: "REJECTED", error: msg });
    }
  }
  await audit(ctx, null, { action: "IMPORT_SUBMITTED", entityType: "ImportBatch", entityId: batch.id, summary: `Import batch "${batch.name}": ${files.length} file(s)${opts.dryRun ? " (dry run)" : ""}`, detail: { count: files.length, dryRun: !!opts.dryRun } });
  return { batchId: batch.id, items: results };
}

/** Worker job: extract, convert, store images, and (unless dry run) create the draft guide. */
export async function processItem(itemId: string) {
  const item = await prisma.importItem.findUniqueOrThrow({ where: { id: itemId }, include: { batch: true } });
  if (!["QUEUED", "PROCESSING", "FAILED"].includes(item.status)) return;
  await prisma.importItem.update({ where: { id: itemId }, data: { status: "PROCESSING", error: null } });
  const ctx = await ctxForUserId(item.createdById);
  try {
    const { buffer, asset } = await assetBuffer(item.orgId, item.sourceAssetId).then((r) => ({ buffer: r.buffer, asset: r.asset }));
    const kind = kindFromMime(asset.mime);
    const { doc, imageBuffers, pageImages } = await extractDocument(buffer, kind, item.filename);
    // store extracted images as immutable IMPORT_IMAGE evidence
    const imgAsset = new Map<string, string>();
    for (const im of doc.images) {
      const buf = imageBuffers.get(im.id)!;
      try { const a = await storeAsset(ctx, { buffer: buf, filename: `import-${im.id}.${im.mime.includes("jpeg") ? "jpg" : "png"}`, purpose: "IMPORT_IMAGE", allow: IMAGE_KINDS, importItemId: itemId }); imgAsset.set(im.id, a.id); im.assetId = a.id; }
      catch (e) { doc.warnings.push(`Image ${im.id} rejected: ${(e as Error).message}`); }
    }
    const pageIds: string[] = [];
    for (const p of pageImages ?? []) { try { const a = await storeAsset(ctx, { buffer: p.buffer, filename: `page-${p.page}.png`, purpose: "IMPORT_IMAGE", allow: ["png"], importItemId: itemId }); pageIds.push(a.id); } catch { /* optional */ } }
    doc.pageImageAssetIds = pageIds;

    const [retired, sites, taxonomy] = await Promise.all([
      prisma.retiredReference.findMany({ where: { orgId: item.orgId } }), prisma.site.findMany({ where: { orgId: item.orgId } }), prisma.taxonomyTerm.findMany({ where: { orgId: item.orgId } }),
    ]);
    const conv = convertToGuide(doc, { retired, sites, taxonomy, templateKey: (item.groupKeys as { template?: string })?.template ?? undefined });
    const groupKeys = { process: conv.metadata.processCode ?? null, site: conv.metadata.siteId ?? conv.metadata.siteText ?? null, system: conv.metadata.systems[0] ?? null, function: conv.metadata.functionCode ?? null, department: conv.metadata.department ?? null };
    const stored = { doc: { ...doc, images: doc.images }, conversion: { flags: conv.flags, metadata: conv.metadata, changeSummary: conv.changeSummary, imageAssociations: conv.imageAssociations, unplacedBlockIds: conv.unplacedBlockIds, stepCount: conv.stepCount, overallConfidence: conv.overallConfidence } };

    if (item.batch?.dryRun) {
      await prisma.importItem.update({ where: { id: itemId }, data: { status: "DRY_RUN_OK", extracted: stored.doc as object, conversion: { ...stored.conversion, content: conv.content } as object, groupKeys, warnings: doc.warnings as object } });
    } else {
      const created = await createDraftFromConversion(ctx, item.id, conv, imgAsset, item.filename, (item.groupKeys as { template?: string })?.template);
      await prisma.importItem.update({ where: { id: itemId }, data: { status: "NEEDS_REVIEW", extracted: stored.doc as object, conversion: stored.conversion as object, guideId: created.guideId, versionId: created.versionId, groupKeys, warnings: doc.warnings as object } });
      await audit(ctx, null, { action: "IMPORT_CONVERTED", entityType: "ImportItem", entityId: itemId, guideId: created.guideId, versionId: created.versionId, summary: `Converted "${item.filename}" into draft ${created.documentId}: ${conv.stepCount} steps, ${conv.flags.length} flags`, detail: { counts: conv.changeSummary.counts, confidence: conv.overallConfidence } });
    }
    if (item.batchId) await finaliseBatchIfDone(item.batchId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.importItem.update({ where: { id: itemId }, data: { status: "FAILED", error: msg.slice(0, 1000) } });
    if (item.batchId) await finaliseBatchIfDone(item.batchId);
    throw e; // let the queue record the failure (retries are bounded)
  }
}

async function createDraftFromConversion(ctx: Ctx, itemId: string, conv: ConversionResult, imgAsset: Map<string, string>, filename: string, templateKey?: string) {
  const m = conv.metadata;
  const tpl = templateKey ?? (m.sapTransactions.length ? "sap" : "general");
  const title = conv.content.title || filename.replace(/\.[^.]+$/, "");
  const { guide, version } = await createGuide(ctx, {
    title, templateKey: tpl, source: "IMPORT", sourceRef: itemId, importConfirmed: false,
    metadata: { siteId: m.siteId ?? undefined, department: m.department, processCode: m.processCode, functionCode: m.functionCode, systems: m.systems, sapTransactions: m.sapTransactions, applications: m.systems },
  });
  // bind images: copy evidence -> content assets
  const content: GuideContent = JSON.parse(JSON.stringify(conv.content));
  content.title = title;
  content.templateKey = tpl;
  const cache = new Map<string, string>();
  for (const s of flattenSteps(content.steps)) {
    if (!s.image?.assetId.startsWith("pending:")) continue;
    const imgId = s.image.assetId.slice(8);
    const evidence = imgAsset.get(imgId);
    if (!evidence) { s.image = undefined; s.origin.flags.push({ code: "image-lost", message: "An image could not be stored and was dropped.", severity: "warn" }); continue; }
    let copy = cache.get(imgId);
    if (!copy) { copy = (await copyAssetAsContent(ctx, evidence, guide.id)).id; cache.set(imgId, copy); }
    s.image.assetId = copy; s.image.sourceAssetId = evidence;
  }
  const d = await getVersionDetail(ctx, version.id);
  await saveContent(ctx, version.id, { ...d.content, ...content }, d.rev);
  return { guideId: guide.id, versionId: version.id, documentId: guide.documentId };
}

async function finaliseBatchIfDone(batchId: string) {
  const pending = await prisma.importItem.count({ where: { batchId, status: { in: ["QUEUED", "PROCESSING"] } } });
  if (pending > 0) return;
  const items = await prisma.importItem.findMany({ where: { batchId } });
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  const converted = items.filter((i) => ["NEEDS_REVIEW", "CONFIRMED", "DRY_RUN_OK"].includes(i.status) && i.conversion);
  // near-duplicates within the batch and against live guides; likely-superseded by legacy document id
  const texts = new Map<string, string>();
  for (const i of converted) {
    const c = ((i.status === "DRY_RUN_OK" ? (i.conversion as { content?: GuideContent }).content : null) ?? (i.versionId ? guideContentSchema.parse((await prisma.guideVersion.findUniqueOrThrow({ where: { id: i.versionId } })).content) : null));
    if (c) texts.set(i.id, [c.title, c.purpose, ...flattenSteps(c.steps).map(stepPlainText)].join(" "));
  }
  const live = await prisma.guide.findMany({ where: { orgId: batch.orgId, liveVersionId: { not: null }, archivedAt: null } });
  const liveVersions = await prisma.guideVersion.findMany({ where: { id: { in: live.map((g) => g.liveVersionId!) } } });
  for (const i of converted) {
    const warnings = ((i.warnings as { code: string }[]) ?? []).filter((w) => !["near-duplicate", "existing-guide-similar", "likely-superseded"].includes(w.code));
    const mine = texts.get(i.id) ?? "";
    for (const j of converted) {
      if (j.id === i.id) continue;
      const sim = similarity(mine, texts.get(j.id) ?? "");
      if (sim >= 0.85 && i.id > j.id) warnings.push({ code: "near-duplicate", message: `Near-duplicate of ${j.filename} (${Math.round(sim * 100)}% similar).`, of: j.id, similarity: sim } as never);
    }
    for (const g of live) {
      const v = liveVersions.find((x) => x.id === g.liveVersionId)!;
      const c = guideContentSchema.parse(v.content);
      const sim = similarity(mine, [c.title, c.purpose, ...flattenSteps(c.steps).map(stepPlainText)].join(" "));
      if (sim >= 0.8) warnings.push({ code: "existing-guide-similar", message: `Similar to existing published guide ${g.documentId} "${g.title}" (${Math.round(sim * 100)}%). It may already be migrated or be a duplicate.`, documentId: g.documentId, similarity: sim } as never);
    }
    const meta = (i.conversion as { metadata?: { legacyDocumentId?: string; legacyVersion?: string; effectiveDate?: string } })?.metadata;
    if (meta?.legacyDocumentId) {
      const sameDoc = converted.filter((j) => j.id !== i.id && (j.conversion as { metadata?: { legacyDocumentId?: string } })?.metadata?.legacyDocumentId === meta.legacyDocumentId);
      for (const j of sameDoc) {
        const jm = (j.conversion as { metadata?: { legacyVersion?: string } }).metadata;
        if (Number(jm?.legacyVersion) > Number(meta.legacyVersion)) warnings.push({ code: "likely-superseded", message: `Document ${meta.legacyDocumentId} v${meta.legacyVersion} is likely superseded by v${jm?.legacyVersion} (${j.filename}).`, of: j.id } as never);
      }
    }
    await prisma.importItem.update({ where: { id: i.id }, data: { warnings: warnings as object[] } });
  }
  const totals = await reconcileBatch(batchId);
  await prisma.importBatch.update({ where: { id: batchId }, data: { status: "COMPLETE", completedAt: new Date(), totals: totals as object } });
}

/** Reconciliation totals: every submitted file must be accounted for. */
export async function reconcileBatch(batchId: string) {
  const items = await prisma.importItem.findMany({ where: { batchId }, select: { status: true } });
  const c = (...s: string[]) => items.filter((i) => s.includes(i.status)).length;
  const t = { submitted: items.length, converted: c("NEEDS_REVIEW", "CONFIRMED", "DRY_RUN_OK"), confirmed: c("CONFIRMED"), duplicates: c("DUPLICATE"), failed: c("FAILED"), rejected: c("REJECTED"), pending: c("QUEUED", "PROCESSING") };
  return { ...t, balanced: t.submitted === t.converted + t.duplicates + t.failed + t.rejected + t.pending };
}

registerJob("import.process", async ({ itemId }: { itemId: string }) => processItem(itemId));

export async function getBatch(ctx: Ctx, batchId: string) {
  const b = await prisma.importBatch.findFirst({ where: { id: batchId, orgId: ctx.orgId } });
  if (!b || (b.createdById !== ctx.userId && !hasRole(ctx, "ADMIN", "AUDITOR", "PROCESS_OWNER"))) throw notFound("Batch");
  const items = await prisma.importItem.findMany({ where: { batchId, orgId: ctx.orgId }, orderBy: { createdAt: "asc" }, select: { id: true, filename: true, status: true, error: true, groupKeys: true, warnings: true, guideId: true, versionId: true, duplicateOfId: true, conversion: true } });
  return { batch: b, items, totals: await reconcileBatch(batchId) };
}

export async function listImports(ctx: Ctx) {
  assertImporter(ctx);
  const [batches, items] = await Promise.all([
    prisma.importBatch.findMany({ where: { orgId: ctx.orgId, createdById: ctx.userId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.importItem.findMany({ where: { orgId: ctx.orgId, createdById: ctx.userId }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, filename: true, status: true, batchId: true, createdAt: true, guideId: true } }),
  ]);
  return { batches, items };
}

async function ownItem(ctx: Ctx, id: string, allowRead = false) {
  const item = await prisma.importItem.findFirst({ where: { id, orgId: ctx.orgId } });
  const ok = item && (item.createdById === ctx.userId || (hasRole(ctx, "AUTHOR") && !allowRead) || hasRole(ctx, "AUDITOR", "ADMIN"));
  if (!item || !ok) throw notFound("Import");
  return item;
}

/** Everything the side-by-side view needs: original blocks (with outcome), converted content and flags. */
export async function getImport(ctx: Ctx, id: string) {
  const item = await ownItem(ctx, id, true);
  const doc = item.extracted as unknown as ExtractedDocument | null;
  const conv = item.conversion as unknown as (Omit<ConversionResult, "content"> & { content?: GuideContent }) | null;
  const version = item.versionId ? await getVersionDetail(ctx, item.versionId).catch(() => null) : null;
  return { item, doc, conversion: conv, version };
}

export async function confirmImport(ctx: Ctx, id: string, input: unknown) {
  const { acknowledged, note } = z.object({ acknowledged: z.literal(true), note: z.string().max(1000).default("") }).parse(input);
  void acknowledged;
  const item = await ownItem(ctx, id);
  if (!hasRole(ctx, "AUTHOR")) throw forbidden();
  if (item.status !== "NEEDS_REVIEW") throw conflict(`Import is ${item.status}; only converted imports awaiting review can be confirmed`);
  if (!item.versionId) throw conflict("No draft was created for this import");
  const v = await prisma.guideVersion.findUniqueOrThrow({ where: { id: item.versionId } });
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(v.status)) throw conflict("The draft is no longer editable");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "GuideVersion" SET "importConfirmed" = true WHERE id = ${v.id}`;
    await tx.importItem.update({ where: { id }, data: { status: "CONFIRMED", confirmedById: ctx.userId, confirmedAt: new Date() } });
    await audit(ctx, null, { action: "IMPORT_CONFIRMED", entityType: "ImportItem", entityId: id, guideId: item.guideId, versionId: item.versionId, summary: `${ctx.name} confirmed the converted content of "${item.filename}" after reviewing it against the original`, detail: { note } }, tx);
  });
  return { ok: true };
}

export async function rejectImport(ctx: Ctx, id: string, reason: string) {
  const item = await ownItem(ctx, id);
  if (reason.trim().length < 3) throw unprocessable("A reason is required");
  if (!["NEEDS_REVIEW", "DRY_RUN_OK", "FAILED", "DUPLICATE"].includes(item.status)) throw conflict(`Import is ${item.status}`);
  if (item.versionId) { const v = await prisma.guideVersion.findUnique({ where: { id: item.versionId } }); if (v?.status === "DRAFT") await discardDraft(ctx, v.id); }
  await prisma.importItem.update({ where: { id }, data: { status: "REJECTED", error: reason.slice(0, 500), guideId: null, versionId: null } });
  await audit(ctx, null, { action: "IMPORT_REJECTED", entityType: "ImportItem", entityId: id, summary: `Rejected import "${item.filename}" (source file retained)`, detail: { reason } });
}

export async function retryImport(ctx: Ctx, id: string) {
  const item = await ownItem(ctx, id);
  if (item.status !== "FAILED") throw conflict("Only failed imports can be retried");
  await prisma.importItem.update({ where: { id }, data: { status: "QUEUED", error: null } });
  await enqueue("import.process", { itemId: id }, { orgId: ctx.orgId });
}

/** Turn a dry-run item into a real draft (after the author has looked at the dry-run result). */
export async function materialiseDryRun(ctx: Ctx, id: string) {
  const item = await ownItem(ctx, id);
  if (item.status !== "DRY_RUN_OK") throw conflict("Only dry-run items can be materialised");
  const conv = item.conversion as unknown as ConversionResult & { content: GuideContent };
  const doc = item.extracted as unknown as ExtractedDocument;
  const imgAsset = new Map(doc.images.filter((i) => i.assetId).map((i) => [i.id, i.assetId!]));
  const created = await createDraftFromConversion(ctx, id, conv, imgAsset, item.filename);
  await prisma.importItem.update({ where: { id }, data: { status: "NEEDS_REVIEW", guideId: created.guideId, versionId: created.versionId } });
  await audit(ctx, null, { action: "IMPORT_CONVERTED", entityType: "ImportItem", entityId: id, guideId: created.guideId, versionId: created.versionId, summary: `Materialised dry-run "${item.filename}" as draft ${created.documentId}` });
  return created;
}

/** Place an unmatched imported image on a step of the draft. */
export async function assignImage(ctx: Ctx, id: string, imageId: string, stepId: string) {
  const item = await ownItem(ctx, id);
  if (!item.versionId) throw conflict("No draft");
  const doc = item.extracted as unknown as ExtractedDocument;
  const im = doc.images.find((i) => i.id === imageId);
  if (!im?.assetId) throw notFound("Image");
  const d = await getVersionDetail(ctx, item.versionId);
  if (!d.canEdit) throw conflict("Draft is not editable");
  const copy = await copyAssetAsContent(ctx, im.assetId, d.guideId);
  const target = flattenSteps(d.content.steps).find((s) => s.id === stepId);
  if (!target) throw notFound("Step");
  target.image = { assetId: copy.id, alt: im.alt ?? "", annotations: [], sourceAssetId: im.assetId };
  await saveContent(ctx, item.versionId, d.content, d.rev);
}

/** Compare: the converted draft (or any guide version) against the older instruction re-extracted from the source. */
export async function compareImportWithGuide(ctx: Ctx, id: string, guideId: string) {
  const item = await ownItem(ctx, id, true);
  const conv = item.conversion as unknown as { content?: GuideContent } | null;
  const version = item.versionId ? await getVersionDetail(ctx, item.versionId) : null;
  const left = conv?.content ?? version?.content;
  if (!left) throw conflict("Nothing to compare yet");
  const g = await prisma.guide.findFirst({ where: { AND: [guideScope(ctx), { id: guideId }] } });
  if (!g?.liveVersionId) throw notFound("Guide");
  const live = await getVersionDetail(ctx, g.liveVersionId);
  return compareContent(live.content, left);
}

export async function exceptionReportCsv(ctx: Ctx, batchId: string) {
  const { items, totals } = await getBatch(ctx, batchId);
  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`; // neutralise spreadsheet formula injection
  const rows = [["file", "status", "reason"]];
  for (const i of items) {
    const w = (i.warnings as { message?: string }[]) ?? [];
    const flags = ((i.conversion as { flags?: { severity: string; message: string }[] } | null)?.flags ?? []).filter((f) => f.severity !== "info");
    if (["FAILED", "DUPLICATE", "REJECTED"].includes(i.status)) rows.push([i.filename, i.status, i.error ?? w[0]?.message ?? ""]);
    else for (const m of [...w.map((x) => x.message), ...flags.map((f) => f.message)].filter(Boolean).slice(0, 12)) rows.push([i.filename, i.status, m as string]);
  }
  rows.push([], ["RECONCILIATION", "", `submitted=${totals.submitted} converted=${totals.converted} duplicates=${totals.duplicates} failed=${totals.failed} rejected=${totals.rejected} pending=${totals.pending} balanced=${totals.balanced}`]);
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}
