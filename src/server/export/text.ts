import JSZip from "jszip";
import { createHash } from "node:crypto";
import { numberSteps, parseInline, isSafeUrl, STEP_KIND_LABELS, stripInline, type Step } from "../../lib/guide-schema";
import type { ExportModel } from "./model";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const inl = (s: string) => parseInline(s).map((p) => (p.t === "bold" ? `<strong>${esc(p.v)}</strong>` : p.t === "code" ? `<code>${esc(p.v)}</code>` : esc(p.v))).join("");

export function toHtml(m: ExportModel, opts: { imagePath?: (stepId: string) => string } = {}): string {
  const k = m.control, c = m.content;
  const img = (s: Step) => { const i = m.images.get(s.id); if (!i || !s.image) return ""; const src = opts.imagePath ? opts.imagePath(s.id) : `data:image/png;base64,${i.png.toString("base64")}`; return `<img src="${esc(src)}" alt="${esc(s.image.alt || "Screenshot")}">`; };
  const list = (t: string, items: string[]) => (items.length ? `<h2>${esc(t)}</h2><ul>${items.map((i) => `<li>${inl(i)}</li>`).join("")}</ul>` : "");
  const step = (s: Step, num: string): string => `<li id="step-${esc(s.id)}" class="step ${esc(s.kind)}"><h3>${num ? `<span class="n">${esc(num)}</span>` : `<span class="k">${esc(STEP_KIND_LABELS[s.kind])}</span>`} ${inl(s.title)}</h3>${s.decision ? `<p><strong>${esc(s.decision.question)}</strong></p>` : ""}${s.exception ? `<p><em>When: ${esc(s.exception.condition)}</em></p>` : ""}${s.text ? `<p>${inl(s.text).replace(/\n/g, "<br>")}</p>` : ""}${s.blockRef ? `<p class="blk"><strong>${esc(s.blockRef.title)}.</strong> ${esc(s.blockRef.body)}</p>` : ""}${img(s)}${s.links.filter((l) => isSafeUrl(l.url)).map((l) => `<p><a href="${esc(l.url)}" rel="noopener noreferrer">${esc(l.label || l.url)}</a></p>`).join("")}${s.decision ? s.decision.branches.map((b, i) => `<div class="branch"><p><strong>If: ${esc(b.label)}</strong></p><ol>${numberSteps(b.steps, `${num}.${String.fromCharCode(65 + i)}.`).filter((x) => x.depth === 0).map((x) => step(x.step, x.number)).join("")}</ol></div>`).join("") : ""}</li>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="followme-control" content="${esc(k.marker)}"><title>${esc(c.title)} (${esc(k.documentId)} v${esc(k.versionLabel)})</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#111827}h1{margin-bottom:4px}.ctl{width:100%;border-collapse:collapse;margin:12px 0}.ctl th,.ctl td{border:1px solid #cbd5e1;padding:4px 8px;text-align:left;font-size:14px}.ctl th{background:#eef2f6;width:170px}.warn{border:2px solid #b45309;background:#fff4ce;padding:10px 14px;border-radius:8px;font-weight:600}.warn.bad{background:#fde2e2}ol.steps,ol{list-style:none;padding:0}.step{border:1px solid #cbd5e1;border-radius:8px;padding:10px 14px;margin:10px 0}.step.warning{background:#fde2e2;border-color:#b91c1c}.step.note,.step.tip{background:#e6f0fa}.step.expected{background:#e6f4ea}.n{display:inline-block;background:#0f766e;color:#fff;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;margin-right:6px}img{max-width:100%;border:1px solid #cbd5e1;border-radius:6px}.branch{margin-left:16px;border-left:4px solid #cbd5e1;padding-left:10px}footer{margin-top:32px;font-size:13px;color:#475569}@media print{.step{break-inside:avoid}}</style></head><body>
<header><h1>${esc(c.title)}</h1><table class="ctl"><tbody>
<tr><th>Document ID</th><td>${esc(k.documentId)}</td></tr><tr><th>Version</th><td>${esc(k.versionLabel)}</td></tr><tr><th>Status</th><td>${k.isDraft ? "DRAFT (not approved)" : k.status === "SUPERSEDED" ? "SUPERSEDED" : "Published"}</td></tr><tr><th>Publication date</th><td>${esc(k.publishedAt ?? "Not published")}</td></tr><tr><th>Effective date</th><td>${esc(k.effectiveDate ?? "-")}</td></tr><tr><th>Review due</th><td>${esc(k.reviewDate ?? "-")}</td></tr><tr><th>Process owner</th><td>${esc(k.owner ?? "-")}</td></tr><tr><th>Classification</th><td>${esc(k.classification)}</td></tr><tr><th>Export timestamp</th><td>${esc(k.exportedAt)}</td></tr><tr><th>Controlled source</th><td><a href="${esc(k.sourceUrl)}">${esc(k.sourceUrl)}</a></td></tr></tbody></table>
<p class="warn ${k.isDraft || k.status === "SUPERSEDED" ? "bad" : ""}" role="note">${esc(k.warning)}</p></header><main>
${c.purpose ? `<h2>Purpose</h2><p>${inl(c.purpose)}</p>` : ""}${c.scope ? `<h2>Scope</h2><p>${inl(c.scope)}</p>` : ""}${c.audience ? `<h2>Audience</h2><p>${esc(c.audience)}</p>` : ""}
${c.responsibilities.length ? `<h2>Responsibilities</h2><table class="ctl"><thead><tr><th>Role</th><th>Responsibility</th></tr></thead><tbody>${c.responsibilities.map((r) => `<tr><td>${esc(r.role)}</td><td>${esc(r.responsibility)}</td></tr>`).join("")}</tbody></table>` : ""}
${list("Prerequisites", c.prerequisites)}${list("Required permissions", c.permissions)}${list("Hazards", c.hazards)}${list("PPE", c.ppe)}${list("Equipment", c.equipment)}${list("Required training", c.training)}
<h2>Procedure</h2><ol class="steps">${numberSteps(c.steps).filter((x) => x.depth === 0).map((x) => step(x.step, x.number)).join("")}</ol>
${c.expectedResult ? `<h2>Expected result</h2><p>${inl(c.expectedResult)}</p>` : ""}${list("Validation checks", c.validationChecks)}
${c.troubleshooting.length ? `<h2>Troubleshooting</h2><table class="ctl"><thead><tr><th>Problem</th><th>What to do</th></tr></thead><tbody>${c.troubleshooting.map((t) => `<tr><td>${esc(t.problem)}</td><td>${esc(t.resolution)}</td></tr>`).join("")}</tbody></table>` : ""}
${list("Related procedures", c.related.map((r) => `${r.documentId ?? ""} ${r.title}`.trim()))}${c.acronyms.length ? `<h2>Definitions and acronyms</h2><dl>${c.acronyms.map((a) => `<dt><strong>${esc(a.term)}</strong></dt><dd>${esc(a.expansion)}</dd>`).join("")}</dl>` : ""}
</main><footer>Exported ${esc(k.exportedAt)} by ${esc(k.exportedBy)}. Uncontrolled when printed. Check <a href="${esc(k.sourceUrl)}">${esc(k.sourceUrl)}</a> for the current version. <!-- ${esc(k.marker)} --></footer></body></html>`;
}

const mdEsc = (s: string) => s.replace(/([\\`\[\]<>])/g, "\\$1");
const mdInl = (s: string) => parseInline(s).map((p) => (p.t === "bold" ? `**${mdEsc(p.v)}**` : p.t === "code" ? `\`${p.v.replace(/`/g, "'")}\`` : mdEsc(p.v))).join("");

export function toMarkdown(m: ExportModel): string {
  const k = m.control, c = m.content;
  const L: string[] = [`# ${mdEsc(c.title)}`, "", `> **${k.warning}**`, "", "| Field | Value |", "|---|---|"];
  for (const [a, b] of [["Document ID", k.documentId], ["Version", k.versionLabel], ["Status", k.isDraft ? "DRAFT (not approved)" : k.status === "SUPERSEDED" ? "SUPERSEDED" : "Published"], ["Publication date", k.publishedAt ?? "Not published"], ["Effective date", k.effectiveDate ?? "-"], ["Review due", k.reviewDate ?? "-"], ["Process owner", k.owner ?? "-"], ["Classification", k.classification], ["Export timestamp", k.exportedAt], ["Controlled source", k.sourceUrl]]) L.push(`| ${a} | ${mdEsc(String(b)).replace(/\|/g, "\\|")} |`);
  L.push("");
  const sec = (t: string, x?: string) => { if (x?.trim()) L.push(`## ${t}`, "", mdInl(x), ""); };
  const list = (t: string, items: string[]) => { if (items.length) L.push(`## ${t}`, "", ...items.map((i) => `- ${mdInl(i)}`), ""); };
  sec("Purpose", c.purpose); sec("Scope", c.scope); sec("Audience", c.audience);
  list("Prerequisites", c.prerequisites); list("Required permissions", c.permissions); list("Hazards", c.hazards); list("PPE", c.ppe); list("Equipment", c.equipment);
  L.push("## Procedure", "");
  const step = (s: Step, num: string, depth: number) => {
    const pad = "  ".repeat(depth);
    L.push(`${pad}${num ? `**${num}.**` : `**${STEP_KIND_LABELS[s.kind]}:**`} ${mdInl(s.title)}`);
    if (s.decision) L.push(`${pad}  ${mdInl(s.decision.question)}`);
    if (s.text) L.push("", ...s.text.split("\n").map((l) => `${pad}  ${mdInl(l)}`));
    if (s.blockRef) L.push("", `${pad}  > **${mdEsc(s.blockRef.title)}.** ${mdEsc(s.blockRef.body)}`);
    if (s.image) L.push("", `${pad}  _[Screenshot: ${mdEsc(stripInline(s.image.alt) || "no description")}]_`);
    L.push("");
    if (s.decision) s.decision.branches.forEach((b, i) => { L.push(`${pad}  *If: ${mdEsc(b.label)}*`, ""); for (const n of numberSteps(b.steps, `${num}.${String.fromCharCode(65 + i)}.`).filter((x) => x.depth === 0)) step(n.step, n.number, depth + 2); });
  };
  for (const n of numberSteps(c.steps).filter((x) => x.depth === 0)) step(n.step, n.number, 0);
  sec("Expected result", c.expectedResult); list("Validation checks", c.validationChecks);
  if (c.troubleshooting.length) L.push("## Troubleshooting", "", ...c.troubleshooting.map((t) => `- **${mdEsc(t.problem)}**: ${mdEsc(t.resolution)}`), "");
  L.push("---", `Exported ${k.exportedAt} by ${mdEsc(k.exportedBy)}. Uncontrolled when printed. Check ${k.sourceUrl} for the current version.`, `<!-- ${k.marker} -->`, "");
  return L.join("\n");
}

/** Offline package: HTML + images + markdown + manifest with checksums. Still a copy: the manifest points at the live source. */
export async function toOfflineZip(m: ExportModel): Promise<Buffer> {
  const zip = new JSZip();
  const html = toHtml(m, { imagePath: (id) => `images/${id}.png` });
  zip.file("index.html", html);
  zip.file("guide.md", toMarkdown(m));
  const files: Record<string, string> = {};
  for (const [id, i] of m.images) { zip.file(`images/${id}.png`, i.png); files[`images/${id}.png`] = createHash("sha256").update(i.png).digest("hex"); }
  files["index.html"] = createHash("sha256").update(html).digest("hex");
  zip.file("manifest.json", JSON.stringify({ documentId: m.control.documentId, version: m.control.versionLabel, status: m.control.status, publishedAt: m.control.publishedAt, exportedAt: m.control.exportedAt, controlledSource: m.control.sourceUrl, contentHash: m.control.contentHash, marker: m.control.marker, files, notice: m.control.warning }, null, 2));
  zip.file("README-CONTROLLED.txt", `${m.control.warning}\n\nDocument ${m.control.documentId} version ${m.control.versionLabel}, exported ${m.control.exportedAt}.\nLive source: ${m.control.sourceUrl}\n`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
