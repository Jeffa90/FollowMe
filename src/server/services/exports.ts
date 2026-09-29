import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { buildExportModel } from "../export/model";
import { toDocx } from "../export/docx";
import { toPdf } from "../export/pdf";
import { toHtml, toMarkdown, toOfflineZip } from "../export/text";
import { sha256 } from "../hash";
import { badRequest } from "../errors";

export const FORMATS = ["docx", "pdf", "html", "md", "zip"] as const;
export type ExportFormat = (typeof FORMATS)[number];
const TYPES: Record<ExportFormat, string> = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf", html: "text/html; charset=utf-8", md: "text/markdown; charset=utf-8", zip: "application/zip" };

export async function exportVersion(ctx: Ctx, versionId: string, format: string) {
  if (!(FORMATS as readonly string[]).includes(format)) throw badRequest(`format must be one of ${FORMATS.join(", ")}`);
  const f = format as ExportFormat;
  const m = await buildExportModel(ctx, versionId);
  const buffer = f === "docx" ? await toDocx(m) : f === "pdf" ? await toPdf(m) : f === "html" ? Buffer.from(toHtml(m)) : f === "md" ? Buffer.from(toMarkdown(m)) : await toOfflineZip(m);
  const hash = sha256(buffer);
  await prisma.exportRecord.create({ data: { orgId: ctx.orgId, guideId: m.guideId, versionId, format: f, exportedById: ctx.userId, sha256: hash, controlRef: m.control.marker } });
  await audit(ctx, null, { action: "EXPORTED", entityType: "GuideVersion", entityId: versionId, guideId: m.guideId, versionId, summary: `Exported ${m.control.documentId} v${m.control.versionLabel} as ${f.toUpperCase()}`, detail: { format: f, sha256: hash, status: m.control.status } });
  return { buffer, contentType: TYPES[f], filename: `${m.control.documentId}_v${m.control.versionLabel}_${m.control.status === "PUBLISHED" || m.control.status === "UNDER_REVIEW" ? "controlled" : m.control.isDraft ? "DRAFT" : "SUPERSEDED"}.${f}`, control: m.control };
}
