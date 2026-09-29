import PDFDocument from "pdfkit";
import fs from "node:fs";
import { numberSteps, stripInline, isSafeUrl, STEP_KIND_LABELS, type Step } from "../../lib/guide-schema";
import type { ExportModel } from "./model";

const FONT_REG = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/TTF/DejaVuSans.ttf"].find((f) => fs.existsSync(f));
const FONT_BOLD = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"].find((f) => fs.existsSync(f));
// Helvetica (WinAnsi) fallback cannot render every character; unsupported ones become "?".
const safe = (s: string) => (FONT_REG ? s : s.replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ£€–—‘’“”•…]/g, "?"));

export function toPdf(m: ExportModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const k = m.control, c = m.content;
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, info: { Title: c.title, Author: "FollowMe", Subject: `Controlled copy ${k.documentId} v${k.versionLabel}`, Keywords: k.marker, Creator: "FollowMe" }, pdfVersion: "1.7", displayTitle: true });
    if (FONT_REG) { doc.registerFont("R", FONT_REG); doc.registerFont("B", FONT_BOLD ?? FONT_REG); } else { doc.registerFont("R", "Helvetica"); doc.registerFont("B", "Helvetica-Bold"); }
    const chunks: Buffer[] = [];
    doc.on("data", (d: Buffer) => chunks.push(d));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const W = doc.page.width - 100;
    const t = (s: string) => safe(stripInline(s));
    const ensure = (h: number) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
    const H = (s: string) => { ensure(50); doc.moveDown(0.6).font("B").fontSize(13).fillColor("#0f172a").text(safe(s)); doc.moveDown(0.2); };
    const P = (s: string, opts: { indent?: number; color?: string } = {}) => { doc.font("R").fontSize(10.5).fillColor(opts.color ?? "#111827").text(t(s), 50 + (opts.indent ?? 0), undefined, { width: W - (opts.indent ?? 0) }); };
    const bullets = (items: string[]) => { for (const i of items.filter(Boolean)) { ensure(20); doc.font("R").fontSize(10.5).fillColor("#111827").text(`•  ${t(i)}`, 60, undefined, { width: W - 10 }); } };

    doc.font("B").fontSize(20).fillColor("#0f172a").text(safe(c.title), { width: W });
    doc.moveDown(0.5);
    const rows: [string, string][] = [["Document ID", k.documentId], ["Version", k.versionLabel], ["Status", k.isDraft ? "DRAFT (not approved)" : k.status === "SUPERSEDED" ? "SUPERSEDED" : "Published"], ["Publication date", k.publishedAt ?? "Not published"], ["Effective date", k.effectiveDate ?? "-"], ["Review due", k.reviewDate ?? "-"], ["Process owner", k.owner ?? "-"], ["Site", k.site ?? "All sites"], ["Classification", k.classification], ["Export timestamp", k.exportedAt], ["Controlled source", k.sourceUrl]];
    const top = doc.y;
    for (const [a, b] of rows) { doc.font("B").fontSize(9).fillColor("#334155").text(a, 50, doc.y, { width: 110, continued: false }); const y = doc.y; doc.font("R").fontSize(9).fillColor("#111827").text(safe(b), 165, y - 11, { width: W - 130, link: a === "Controlled source" ? b : undefined }); doc.moveDown(0.1); }
    void top;
    doc.image(m.qr, doc.page.width - 130, 50, { width: 70 });
    doc.moveDown(0.5);
    const bx = doc.y;
    doc.rect(50, bx, W, 44).fill(k.isDraft || k.status === "SUPERSEDED" ? "#fde2e2" : "#fff4ce");
    doc.font("B").fontSize(9.5).fillColor("#7c2d12").text(safe(k.warning), 58, bx + 6, { width: W - 16 });
    doc.y = bx + 52;
    for (const [tt, tx] of [["Purpose", c.purpose], ["Scope", c.scope], ["Audience", c.audience]] as const) if (tx) { H(tt); P(tx); }
    if (c.responsibilities.length) { H("Responsibilities"); for (const r of c.responsibilities) { ensure(20); doc.font("B").fontSize(10.5).text(safe(r.role || "-"), 50, undefined, { continued: true, width: W }).font("R").text(`: ${t(r.responsibility)}`); } }
    for (const [tt, items] of [["Prerequisites", c.prerequisites], ["Required permissions", c.permissions], ["Hazards", c.hazards], ["PPE", c.ppe], ["Equipment", c.equipment], ["Required training", c.training], ["Quality requirements", c.qualityRequirements], ["Regulatory requirements", c.regulatory], ["Policy requirements", c.policies]] as [string, string[]][]) if (items.length) { H(tt); bullets(items); }
    H("Procedure");
    const step = (s: Step, num: string, depth: number) => {
      ensure(60);
      const ind = 14 * depth;
      const color = s.kind === "warning" ? "#b91c1c" : "#0f172a";
      doc.moveDown(0.4).font("B").fontSize(11).fillColor(color).text(`${num ? num + ". " : STEP_KIND_LABELS[s.kind] + ": "}${t(s.title)}`, 50 + ind, undefined, { width: W - ind });
      if (s.decision) P(s.decision.question, { indent: ind });
      if (s.exception) P(`When: ${s.exception.condition}`, { indent: ind });
      if (s.physical?.location || s.physical?.equipment) P(`${s.physical.location ? "Location: " + s.physical.location + ". " : ""}${s.physical.equipment ? "Equipment: " + s.physical.equipment + "." : ""}`, { indent: ind, color: "#475569" });
      if (s.text) P(s.text, { indent: ind, color: s.kind === "warning" ? "#7f1d1d" : undefined });
      if (s.blockRef) P(`${s.blockRef.title}. ${s.blockRef.body}`, { indent: ind, color: "#7c2d12" });
      const img = m.images.get(s.id);
      if (img) { const w = Math.min(W - ind, 380), hgt = (img.height / img.width) * w; ensure(hgt + 10); doc.moveDown(0.2); doc.image(img.png, 50 + ind, doc.y, { width: w, alt: s.image?.alt || "Screenshot" } as never); doc.y += hgt + 6; }
      for (const l of s.links.filter((x) => isSafeUrl(x.url) && /^https?:/.test(x.url))) doc.font("R").fontSize(10).fillColor("#0563c1").text(safe(l.label || l.url), 50 + ind, undefined, { link: l.url, underline: true });
      if (s.decision) s.decision.branches.forEach((b, i) => { doc.font("B").fontSize(10.5).fillColor("#0f172a").text(`If: ${safe(b.label)}`, 64 + ind, undefined, { width: W - ind }); for (const n of numberSteps(b.steps, `${num}.${String.fromCharCode(65 + i)}.`).filter((x) => x.depth === 0)) step(n.step, n.number, depth + 2); });
    };
    for (const n of numberSteps(c.steps).filter((x) => x.depth === 0)) step(n.step, n.number, 0);
    if (c.expectedResult) { H("Expected result"); P(c.expectedResult); }
    if (c.validationChecks.length) { H("Validation checks"); bullets(c.validationChecks); }
    if (c.troubleshooting.length) { H("Troubleshooting"); for (const tr of c.troubleshooting) { ensure(24); doc.font("B").fontSize(10.5).fillColor("#111827").text(safe(tr.problem), 50, undefined, { width: W }); P(tr.resolution, { indent: 12 }); } }
    if (c.related.length) { H("Related procedures"); bullets(c.related.map((r) => `${r.documentId ? r.documentId + " " : ""}${r.title}`)); }
    if (c.acronyms.length) { H("Definitions and acronyms"); for (const a of c.acronyms) P(`${a.term}: ${a.expansion}`); }

    // Header/footer on EVERY page (control info + live-source warning + page x of y)
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // otherwise pdfkit would open a new page for text placed in the bottom margin
      doc.page.margins.top = 0;
      doc.font("R").fontSize(7.5).fillColor("#555");
      doc.text(safe(`${k.documentId} v${k.versionLabel} | ${k.isDraft ? "DRAFT" : k.status === "SUPERSEDED" ? "SUPERSEDED" : "Controlled copy"} | ${k.marker}`), 50, 24, { width: W, align: "right", lineBreak: false });
      doc.text(safe(`Exported ${k.exportedAt}. Uncontrolled when printed. Check ${k.sourceUrl} for the current version.   Page ${i - range.start + 1} of ${range.count}`), 50, doc.page.height - 38, { width: W, align: "left", lineBreak: false });
    }
    doc.end();
  });
}
