import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel, ImageRun, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { numberSteps, parseInline, isSafeUrl, STEP_KIND_LABELS, type Step } from "../../lib/guide-schema";
import type { ExportModel } from "./model";

const runs = (text: string, base: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) =>
  parseInline(text).map((p) => new TextRun({ text: p.v, bold: base.bold || p.t === "bold", font: p.t === "code" ? "Consolas" : undefined, italics: base.italics, size: base.size, color: base.color }));
const cell = (children: Paragraph[], shade?: string, w = 4500) => new TableCell({ width: { size: w, type: WidthType.DXA }, shading: shade ? { type: ShadingType.CLEAR, fill: shade, color: "auto" } : undefined, children });
const p = (text: string, o: Record<string, unknown> = {}) => new Paragraph({ children: runs(text), spacing: { after: 100 }, ...o });
const h = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 } });
const list = (items: string[]) => items.filter(Boolean).map((t) => new Paragraph({ children: runs(t), bullet: { level: 0 }, spacing: { after: 40 } }));

export async function toDocx(m: ExportModel): Promise<Buffer> {
  const c = m.content, k = m.control;
  const kv: [string, string][] = [
    ["Document ID", k.documentId], ["Version", k.versionLabel], ["Status", k.isDraft ? "DRAFT (not approved)" : k.status === "SUPERSEDED" ? "SUPERSEDED" : "Published"],
    ["Publication date", k.publishedAt ?? "Not published"], ["Effective date", k.effectiveDate ?? "—"], ["Review due", k.reviewDate ?? "—"], ["Process owner", k.owner ?? "—"],
    ["Site", k.site ?? "All sites"], ["Classification", k.classification], ["Export timestamp", k.exportedAt], ["Exported by", k.exportedBy],
  ];
  const ctrlRows = kv.map(([a, b]) => new TableRow({ children: [cell([new Paragraph({ children: [new TextRun({ text: a, bold: true })] })], "EEF2F6", 2400), cell([new Paragraph(b)], undefined, 6600)] }));
  ctrlRows.push(new TableRow({ children: [cell([new Paragraph({ children: [new TextRun({ text: "Controlled source", bold: true })] })], "EEF2F6", 2400), cell([new Paragraph({ children: [new ExternalHyperlink({ link: k.sourceUrl, children: [new TextRun({ text: k.sourceUrl, style: "Hyperlink", color: "0563C1", underline: {} })] })] })], undefined, 6600)] }));

  const body: (Paragraph | Table)[] = [
    new Paragraph({ text: c.title, heading: HeadingLevel.TITLE }),
    new Table({ width: { size: 9000, type: WidthType.DXA }, rows: ctrlRows }),
    new Paragraph({ spacing: { before: 160, after: 160 }, shading: { type: ShadingType.CLEAR, fill: k.isDraft || k.status === "SUPERSEDED" ? "FDE2E2" : "FFF4CE", color: "auto" }, border: { top: { style: BorderStyle.SINGLE, size: 8, color: "B45309", space: 4 }, bottom: { style: BorderStyle.SINGLE, size: 8, color: "B45309", space: 4 } }, children: [new TextRun({ text: k.warning, bold: true })] }),
    new Paragraph({ children: [new ImageRun({ type: "png", data: m.qr, transformation: { width: 80, height: 80 }, altText: { title: "QR code", description: `QR code linking to the live source ${k.sourceUrl}`, name: "qr" } })] }),
  ];
  const sec = (title: string, text?: string) => { if (text?.trim()) body.push(h(title), ...text.split("\n").map((l) => p(l))); };
  sec("Purpose", c.purpose); sec("Scope", c.scope); sec("Audience", c.audience);
  if (c.responsibilities.length) body.push(h("Responsibilities"), new Table({ width: { size: 9000, type: WidthType.DXA }, rows: [new TableRow({ tableHeader: true, children: [cell([p("Role")], "EEF2F6"), cell([p("Responsibility")], "EEF2F6")] }), ...c.responsibilities.map((r) => new TableRow({ children: [cell([p(r.role)]), cell([p(r.responsibility)])] }))] }));
  for (const [t, items] of [["Prerequisites", c.prerequisites], ["Required permissions", c.permissions], ["Hazards", c.hazards], ["PPE", c.ppe], ["Equipment", c.equipment], ["Required training", c.training], ["Quality requirements", c.qualityRequirements], ["Regulatory requirements", c.regulatory], ["Policy requirements", c.policies]] as [string, string[]][]) if (items.length) body.push(h(t), ...list(items));
  body.push(h("Procedure"));
  const renderStep = (s: Step, number: string, depth: number) => {
    const indent = { left: 360 * depth };
    const shade = s.kind === "warning" ? "FDE2E2" : s.kind === "note" || s.kind === "tip" ? "E6F0FA" : s.kind === "control" ? "FFF4CE" : s.kind === "expected" ? "E6F4EA" : undefined;
    const label = number ? `${number}. ` : `${STEP_KIND_LABELS[s.kind]}: `;
    const head = new Paragraph({ indent, keepNext: true, spacing: { before: 140, after: 60 }, shading: shade ? { type: ShadingType.CLEAR, fill: shade, color: "auto" } : undefined, children: [new TextRun({ text: label, bold: true }), ...runs(s.title || (s.kind === "warning" ? "" : ""), { bold: true })] });
    body.push(head);
    if (s.decision) body.push(new Paragraph({ indent, children: [new TextRun({ text: s.decision.question, bold: true, italics: true })] }));
    if (s.exception) body.push(new Paragraph({ indent, children: [new TextRun({ text: `When: ${s.exception.condition}`, italics: true })] }));
    if (s.physical?.location || s.physical?.equipment) body.push(new Paragraph({ indent, children: [new TextRun({ text: `${s.physical.location ? "Location: " + s.physical.location + ". " : ""}${s.physical.equipment ? "Equipment: " + s.physical.equipment + "." : ""}`, italics: true })] }));
    for (const line of (s.text || "").split("\n").filter(Boolean)) body.push(new Paragraph({ indent, children: runs(line), shading: shade ? { type: ShadingType.CLEAR, fill: shade, color: "auto" } : undefined, spacing: { after: 60 } }));
    if (s.blockRef) body.push(new Paragraph({ indent, shading: { type: ShadingType.CLEAR, fill: "FFF4CE", color: "auto" }, children: [new TextRun({ text: `${s.blockRef.title}. `, bold: true }), new TextRun(s.blockRef.body)] }));
    const img = m.images.get(s.id);
    if (img && s.image) {
      const w = Math.min(560, img.width), hgt = Math.round((img.height / img.width) * w);
      body.push(new Paragraph({ indent, children: [new ImageRun({ type: "png", data: img.png, transformation: { width: w, height: hgt }, altText: { title: `Step ${number || ""} screenshot`, description: s.image.alt || "Screenshot", name: `img-${s.id}` } })] }));
    }
    for (const l of s.links.filter((x) => isSafeUrl(x.url) && /^https?:/.test(x.url))) body.push(new Paragraph({ indent, children: [new ExternalHyperlink({ link: l.url, children: [new TextRun({ text: l.label || l.url, color: "0563C1", underline: {} })] })] }));
    if (s.decision) s.decision.branches.forEach((b, i) => { body.push(new Paragraph({ indent: { left: 360 * (depth + 1) }, children: [new TextRun({ text: `If: ${b.label}`, bold: true })] })); for (const n of numberSteps(b.steps, `${number}.${String.fromCharCode(65 + i)}.`).filter((x) => x.depth === 0)) renderStep(n.step, n.number, depth + 2); });
  };
  for (const n of numberSteps(c.steps).filter((x) => x.depth === 0)) renderStep(n.step, n.number, 0);
  sec("Expected result", c.expectedResult);
  if (c.validationChecks.length) body.push(h("Validation checks"), ...list(c.validationChecks));
  if (c.troubleshooting.length) body.push(h("Troubleshooting"), new Table({ width: { size: 9000, type: WidthType.DXA }, rows: [new TableRow({ tableHeader: true, children: [cell([p("Problem")], "EEF2F6"), cell([p("What to do")], "EEF2F6")] }), ...c.troubleshooting.map((t) => new TableRow({ children: [cell([p(t.problem)]), cell([p(t.resolution)])] }))] }));
  if (c.related.length) body.push(h("Related procedures"), ...list(c.related.map((r) => `${r.documentId ? r.documentId + " " : ""}${r.title}`)));
  if (c.acronyms.length) body.push(h("Definitions and acronyms"), ...c.acronyms.map((a) => p(`**${a.term}**: ${a.expansion}`)));

  const doc = new Document({
    creator: "FollowMe", title: c.title, subject: `Controlled copy ${k.documentId} v${k.versionLabel}`, description: k.marker, keywords: k.marker,
    customProperties: [{ name: "FollowMeDocumentId", value: k.documentId }, { name: "FollowMeVersion", value: k.versionLabel }, { name: "FollowMeContentHash", value: k.contentHash }],
    sections: [{
      properties: { page: { margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${k.documentId} v${k.versionLabel}  |  ${k.isDraft ? "DRAFT" : k.status === "SUPERSEDED" ? "SUPERSEDED" : "Controlled copy"}  |  ${k.marker}`, size: 16, color: "555555" })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: `Exported ${k.exportedAt}. Uncontrolled when printed. Check ${k.sourceUrl} for the current version.  Page `, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 }), new TextRun({ text: " of ", size: 16 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16 })] })] }) },
      children: body,
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
