// Extraction of text, structure, tables, images, metadata and document-control fields from legacy files.
// All content is treated as UNTRUSTED data: it is parsed, never executed or rendered as HTML, and never followed as instructions.
import JSZip from "jszip";
import * as cheerio from "cheerio";
import mammoth from "mammoth";
import { marked } from "marked";
import { XMLParser } from "fast-xml-parser";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { getDocumentProxy } from "unpdf";
import type { DetectedKind } from "../upload-validation";
import { ExtractResult, ExtractedBlock, ExtractedDocument, ExtractedImageMeta } from "./types";
import { ocrProvider } from "./ocr";

const exec = promisify(execFile);
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, trimValues: false });
const clean = (s: string) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
const MAX_BLOCKS = 5000;
const MAX_IMAGES = 200;

class Builder {
  blocks: ExtractedBlock[] = [];
  images: ExtractedImageMeta[] = [];
  buffers = new Map<string, Buffer>();
  warnings: string[] = [];
  private n = 0;
  add(b: Omit<ExtractedBlock, "id" | "order">) {
    if (this.blocks.length >= MAX_BLOCKS) { if (!this.warnings.includes("Document truncated at 5000 blocks")) this.warnings.push("Document truncated at 5000 blocks"); return; }
    if (b.type !== "image" && !b.text && !b.rows) return;
    this.blocks.push({ ...b, id: `b${++this.n}`, order: this.n });
  }
  async addImage(buf: Buffer, mime: string, page?: number, alt?: string) {
    if (this.images.length >= MAX_IMAGES) { if (!this.warnings.includes("More than 200 images: extra images skipped")) this.warnings.push("More than 200 images: extra images skipped"); return; }
    let w: number | null = null, h: number | null = null;
    try { const m = await sharp(buf, { failOn: "none" }).metadata(); w = m.width ?? null; h = m.height ?? null; } catch { this.warnings.push("An embedded image could not be decoded and was skipped"); return; }
    const id = `img${this.images.length + 1}`;
    this.buffers.set(id, buf);
    const order = this.blocks.length + 1;
    this.images.push({ id, mime, width: w, height: h, page, order, alt });
    this.add({ type: "image", text: alt ?? "", imageId: id, page });
  }
}

// ---------- document-control field detection ----------
const CONTROL_PATTERNS: [string, RegExp][] = [
  ["documentId", /\b(?:document|doc|procedure|wi|sop|ref(?:erence)?)\.?\s*(?:no|number|id|ref)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-_./]{2,30})/i],
  ["version", /\b(?:version|rev(?:ision)?|issue)\.?\s*(?:no\.?|number)?\s*[:\-]?\s*(v?\d+(?:\.\d+)?[a-z]?)\b/i],
  ["effectiveDate", /\b(?:effective(?:\s+date)?|issue\s+date|date\s+issued|publication\s+date)\s*[:\-]?\s*(\d{1,2}[\s/.\-]\w{3,9}[\s/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})/i],
  ["reviewDate", /\b(?:review\s+date|next\s+review|due\s+for\s+review)\s*[:\-]?\s*(\d{1,2}[\s/.\-]\w{3,9}[\s/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})/i],
  ["owner", /\b(?:process\s+owner|document\s+owner|owner)\s*[:\-]\s*([A-Z][\w.'\- ]{2,40})/i],
  ["author", /\b(?:author|prepared\s+by|written\s+by)\s*[:\-]\s*([A-Z][\w.'\- ]{2,40})/i],
  ["approvedBy", /\b(?:approved\s+by|authori[sz]ed\s+by)\s*[:\-]\s*([A-Z][\w.'\- ]{2,40})/i],
  ["site", /\b(?:site|plant|location)\s*[:\-]\s*([A-Za-z][\w .'\-]{2,40})/i],
  ["department", /\b(?:department|dept|function|team)\s*[:\-]\s*([A-Za-z][\w &.'\-]{2,40})/i],
];
export function detectDocControl(texts: string[]): Record<string, string> {
  const found: Record<string, string[]> = {};
  for (const t of texts) {
    for (const line of t.split(/\n|\t|\|/)) {
      for (const [k, re] of CONTROL_PATTERNS) {
        const m = re.exec(line.trim());
        if (m) (found[k] ??= []).push(m[1].trim().replace(/\s{2,}.*/, ""));
      }
    }
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(found)) {
    const uniq = [...new Set(v)];
    out[k] = uniq[0];
    if (uniq.length > 1) out[`${k}__conflict`] = uniq.join(" | "); // contradictory values are surfaced, not silently resolved
  }
  return out;
}

// ---------- DOCX ----------
async function docxProps(zip: JSZip) {
  const props: ExtractedDocument["metadata"] = {};
  const core = await zip.file("docProps/core.xml")?.async("string");
  if (core) {
    const c = xml.parse(core)?.coreProperties ?? {};
    const v = (x: unknown) => (typeof x === "string" ? x : (x as { "#text"?: string })?.["#text"]);
    props.title = v(c.title); props.author = v(c.creator); props.created = v(c.created); props.modified = v(c.modified);
  }
  return props;
}
function xmlText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(xmlText).join("");
  const o = node as Record<string, unknown>;
  let s = "";
  for (const [k, v] of Object.entries(o)) {
    if (k === "t") s += xmlText(typeof v === "object" && v && "#text" in (v as object) ? (v as Record<string, unknown>)["#text"] : v);
    else if (k === "p" || k === "tr") s += (Array.isArray(v) ? v : [v]).map((x) => xmlText(x)).join("\n") + "\n";
    else if (k === "tab") s += "\t";
    else if (!k.startsWith("@_")) s += xmlText(v);
  }
  return s;
}

async function extractDocx(buf: Buffer, b: Builder): Promise<Partial<ExtractedDocument>> {
  const zip = await JSZip.loadAsync(buf);
  const metadata = await docxProps(zip);
  const headerTexts: string[] = [];
  for (const name of Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))) {
    const t = clean(xmlText(xml.parse(await zip.files[name].async("string"))));
    if (t) headerTexts.push(t);
  }
  const imgQueue: { id: string; buf: Buffer; mime: string }[] = [];
  let imgN = 0;
  const result = await mammoth.convertToHtml({ buffer: buf }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      const data = Buffer.from(await image.read("base64"), "base64");
      const id = `mimg${++imgN}`;
      imgQueue.push({ id, buf: data, mime: image.contentType });
      return { src: `followme-img:${id}`, alt: (image as { altText?: string }).altText ?? "" };
    }),
  });
  for (const m of result.messages.slice(0, 10)) if (m.type === "warning") b.warnings.push(`DOCX: ${m.message}`.slice(0, 200));
  const $ = cheerio.load(result.value);
  const imgById = new Map(imgQueue.map((i) => [i.id, i]));
  const walk = async (el: cheerio.Cheerio<any>, depth = 0, ordered = false, counters: number[] = []) => {
    for (const node of el.children().toArray()) {
      const n = $(node);
      const tag = (node as any).tagName?.toLowerCase();
      if (/^h[1-6]$/.test(tag)) b.add({ type: "heading", level: Number(tag[1]), text: clean(n.text()) });
      else if (tag === "p") {
        const imgs = n.find("img").toArray();
        const text = clean(n.clone().find("img").remove().end().text());
        if (text) b.add({ type: "paragraph", text });
        for (const im of imgs) { const src = $(im).attr("src") ?? ""; const q = imgById.get(src.replace("followme-img:", "")); if (q) await b.addImage(q.buf, q.mime, undefined, $(im).attr("alt") || undefined); }
      } else if (tag === "ol" || tag === "ul") {
        const isOl = tag === "ol";
        let i = 0;
        for (const li of n.children("li").toArray()) {
          i++;
          const l = $(li);
          const own = clean(l.clone().children("ol,ul").remove().end().find("img").remove().end().text());
          if (own) b.add({ type: "list_item", level: depth, text: own, ordered: isOl, listNumber: isOl ? [...counters, i].join(".") : undefined });
          for (const im of l.find("img").toArray()) { const q = imgById.get(($(im).attr("src") ?? "").replace("followme-img:", "")); if (q) await b.addImage(q.buf, q.mime, undefined, $(im).attr("alt") || undefined); }
          const nested = l.children("ol,ul");
          if (nested.length) await walk(l, depth + 1, isOl, [...counters, i]);
        }
      } else if (tag === "table") {
        const rows = n.find("tr").toArray().map((tr) => $(tr).children("td,th").toArray().map((c) => clean($(c).text())));
        if (rows.length) b.add({ type: "table", text: rows.map((r) => r.join(" | ")).join("\n"), rows });
        for (const im of n.find("img").toArray()) { const q = imgById.get(($(im).attr("src") ?? "").replace("followme-img:", "")); if (q) await b.addImage(q.buf, q.mime); }
      } else if (tag) await walk(n, depth, ordered, counters);
    }
  };
  await walk($("body"));
  for (const t of headerTexts) b.add({ type: "header_footer", text: t });
  const control = detectDocControl([...headerTexts, ...b.blocks.filter((x) => x.type === "table").slice(0, 2).map((x) => x.text), ...b.blocks.filter((x) => x.type === "paragraph").slice(0, 12).map((x) => x.text)]);
  return { metadata, docControl: control };
}

// ---------- PPTX ----------
async function extractPptx(buf: Buffer, b: Builder): Promise<Partial<ExtractedDocument>> {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, c) => Number(a.match(/(\d+)\.xml/)![1]) - Number(c.match(/(\d+)\.xml/)![1]));
  const metadata = await docxProps(zip);
  let page = 0;
  for (const name of slides) {
    page++;
    const doc = xml.parse(await zip.files[name].async("string"));
    const shapes = ([] as any[]).concat(doc?.sld?.cSld?.spTree?.sp ?? []);
    let first = true;
    for (const sp of shapes) {
      const isTitle = /title/i.test(sp?.nvSpPr?.nvPr?.ph?.["@_type"] ?? "");
      const paras = ([] as any[]).concat(sp?.txBody?.p ?? []);
      for (const p of paras) {
        const runs = ([] as any[]).concat(p?.r ?? []);
        const text = clean(runs.map((r) => (typeof r?.t === "object" ? r.t?.["#text"] ?? "" : r?.t ?? "")).join(""));
        if (!text) continue;
        if (isTitle || (first && !isTitle && false)) b.add({ type: "heading", level: 2, text, page });
        else b.add({ type: "list_item", level: Number(p?.pPr?.["@_lvl"] ?? 0), text, page, ordered: false });
      }
      first = false;
    }
    const relsFile = zip.file(`ppt/slides/_rels/${path.basename(name)}.rels`);
    if (relsFile) {
      const rels = ([] as any[]).concat(xml.parse(await relsFile.async("string"))?.Relationships?.Relationship ?? []);
      for (const r of rels.filter((x) => /image/.test(x["@_Type"] ?? ""))) {
        const target = path.posix.normalize(path.posix.join("ppt/slides", r["@_Target"]));
        const f = zip.file(target);
        if (f) await b.addImage(await f.async("nodebuffer"), /png/i.test(target) ? "image/png" : "image/jpeg", page);
      }
    }
  }
  return { metadata: { ...metadata, pages: slides.length }, docControl: detectDocControl(b.blocks.slice(0, 15).map((x) => x.text)) };
}

// ---------- HTML / Markdown ----------
async function extractHtml(html: string, b: Builder): Promise<Partial<ExtractedDocument>> {
  const $ = cheerio.load(html);
  $("script,style,iframe,object,embed,form,noscript,link,meta").remove();
  const title = clean($("title").first().text());
  const walk = async (el: cheerio.Cheerio<any>) => {
    for (const node of el.children().toArray()) {
      const n = $(node); const tag = (node as any).tagName?.toLowerCase();
      if (/^h[1-6]$/.test(tag)) b.add({ type: "heading", level: Number(tag[1]), text: clean(n.text()) });
      else if (tag === "p" || tag === "pre" || tag === "blockquote") b.add({ type: "paragraph", text: clean(n.text()) });
      else if (tag === "ol" || tag === "ul") { let i = 0; for (const li of n.children("li").toArray()) { i++; b.add({ type: "list_item", level: 0, ordered: tag === "ol", listNumber: tag === "ol" ? String(i) : undefined, text: clean($(li).clone().children("ol,ul").remove().end().text()) }); } }
      else if (tag === "table") { const rows = n.find("tr").toArray().map((tr) => $(tr).children("td,th").toArray().map((c) => clean($(c).text()))); if (rows.length) b.add({ type: "table", text: rows.map((r) => r.join(" | ")).join("\n"), rows }); }
      else if (tag === "img") {
        const src = n.attr("src") ?? "";
        const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(src);
        if (m) await b.addImage(Buffer.from(m[2], "base64"), m[1], undefined, n.attr("alt") || undefined);
        else b.warnings.push(`External image not fetched (untrusted source): ${src.slice(0, 80)}`);
      } else if (tag) await walk(n);
    }
  };
  await walk($("body").length ? $("body") : $.root());
  return { metadata: { title }, docControl: detectDocControl(b.blocks.slice(0, 15).map((x) => x.text)) };
}

async function extractMarkdown(md: string, b: Builder): Promise<Partial<ExtractedDocument>> {
  const tokens = marked.lexer(md);
  const inline = (t: string) => clean(t.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, ""));
  for (const t of tokens) {
    if (t.type === "heading") b.add({ type: "heading", level: t.depth, text: inline(t.text) });
    else if (t.type === "paragraph") {
      if (/!\[[^\]]*\]\([^)]*\)/.test(t.text)) b.warnings.push("Markdown image references are not fetched (untrusted); re-add screenshots manually");
      b.add({ type: "paragraph", text: inline(t.text) });
    } else if (t.type === "list") {
      let i = t.start === "" ? 1 : Number(t.start || 1);
      for (const it of t.items) { b.add({ type: "list_item", level: 0, ordered: t.ordered, listNumber: t.ordered ? String(i) : undefined, text: inline(it.text.split("\n")[0]) }); i++; }
    } else if (t.type === "table") {
      const rows = [t.header.map((h: { text: string }) => inline(h.text)), ...t.rows.map((r: { text: string }[]) => r.map((c) => inline(c.text)))];
      b.add({ type: "table", text: rows.map((r) => r.join(" | ")).join("\n"), rows });
    } else if (t.type === "code" || t.type === "blockquote") b.add({ type: "paragraph", text: inline((t as { text: string }).text) });
  }
  return { docControl: detectDocControl(b.blocks.slice(0, 15).map((x) => x.text)) };
}

// ---------- PDF ----------
async function tmpdir() { return fs.mkdtemp(path.join(os.tmpdir(), "followme-pdf-")); }
async function hasBin(bin: string) { try { await exec("which", [bin]); return true; } catch { return false; } }

interface Line { y: number; x: number; size: number; text: string; bold: boolean; page: number }

async function pdfLines(buf: Buffer): Promise<{ lines: Line[]; pages: number; meta: ExtractedDocument["metadata"] }> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const lines: Line[] = [];
  const info = (await pdf.getMetadata().catch(() => null))?.info as Record<string, string> | undefined;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as any[]).filter((i) => typeof i.str === "string" && i.str.trim() !== "" || i.str === " ");
    const rows: { y: number; items: any[] }[] = [];
    for (const it of items) {
      const y = it.transform[5];
      const size = Math.abs(it.transform[3]) || it.height || 10;
      let row = rows.find((r) => Math.abs(r.y - y) < size * 0.4);
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push(it);
    }
    rows.sort((a, c) => c.y - a.y);
    for (const r of rows) {
      r.items.sort((a, c) => a.transform[4] - c.transform[4]);
      let text = "";
      let prevEnd = 0;
      for (const it of r.items) {
        const x = it.transform[4];
        if (text && x - prevEnd > (Math.abs(it.transform[3]) || 10) * 0.15 && !text.endsWith(" ") && !it.str.startsWith(" ")) text += " ";
        text += it.str;
        prevEnd = x + (it.width ?? 0);
      }
      const t = text.replace(/\s+/g, " ").trim();
      if (!t) continue;
      const size = Math.max(...r.items.map((i) => Math.abs(i.transform[3]) || i.height || 10));
      const bold = r.items.some((i) => /bold|black|heavy/i.test(tc.styles?.[i.fontName]?.fontFamily ?? "") || /bold/i.test(String(i.fontName)));
      lines.push({ y: r.y, x: r.items[0].transform[4], size, text: t, bold, page: p });
    }
  }
  return { lines, pages: pdf.numPages, meta: { title: info?.Title || undefined, author: info?.Author || undefined, created: info?.CreationDate || undefined, pages: pdf.numPages, producer: info?.Producer || undefined } };
}

const LIST_RE = /^(?:(\d+(?:\.\d+){0,3})[.)]?|([a-z])[.)]|[•●▪◦\-–—*])\s+(.*)$/;
const KNOWN_SECTION = /^(?:\d+[.)]?\s*)?(purpose|objective|scope|applicability|responsibilit\w*|definitions?|abbreviations?|prerequisites?|equipment|ppe|hazards?|safety|procedure|process|instructions?|steps|method|troubleshooting|references?|related documents|records|revision history|document history|approvals?|expected result|outcome|verification|validation)\s*:?$/i;

function linesToBlocks(lines: Line[], b: Builder) {
  if (!lines.length) return;
  const sizes = lines.map((l) => l.size).sort((a, c) => a - c);
  const body = sizes[Math.floor(sizes.length / 2)] || 10;
  let para: { text: string; page: number; lastY: number; size: number } | null = null;
  let lastList: number | null = null;
  const flush = () => { if (para) { b.add({ type: "paragraph", text: para.text, page: para.page, fontScale: para.size / body }); para = null; } };
  for (const l of lines) {
    const scale = l.size / body;
    const isKnown = KNOWN_SECTION.test(l.text);
    const isBig = scale >= 1.18 || (l.bold && l.text.length < 70 && !/[.;,]$/.test(l.text) && !LIST_RE.test(l.text));
    if (isBig || isKnown) {
      flush(); lastList = null;
      b.add({ type: "heading", level: scale >= 1.5 ? 1 : scale >= 1.25 ? 2 : 3, text: l.text.replace(/^\d+[.)]?\s+/, (m) => (isKnown ? "" : m)), page: l.page, fontScale: scale });
      continue;
    }
    const m = LIST_RE.exec(l.text);
    if (m && m[3]) {
      flush();
      const num = m[1] ?? m[2];
      b.add({ type: "list_item", level: 0, ordered: !!num, listNumber: num, text: m[3], page: l.page, fontScale: scale });
      lastList = b.blocks.length - 1;
      para = null;
      continue;
    }
    // continuation of the previous list item (wrapped line) or paragraph
    const prev = lastList !== null ? b.blocks[lastList] : null;
    if (prev && prev.page === l.page && Math.abs(scale - (prev.fontScale ?? 1)) < 0.1) { prev.text += " " + l.text; continue; }
    if (para && para.page === l.page && para.lastY - l.y < l.size * 1.9 && Math.abs(para.size - l.size) < 0.5) { para.text += " " + l.text; para.lastY = l.y; continue; }
    flush(); lastList = null;
    para = { text: l.text, page: l.page, lastY: l.y, size: l.size };
  }
  flush();
}

async function extractPdf(buf: Buffer, b: Builder): Promise<{ partial: Partial<ExtractedDocument>; pageImages: { page: number; buffer: Buffer }[] }> {
  const dir = await tmpdir();
  const pageImages: { page: number; buffer: Buffer }[] = [];
  try {
    const { lines, pages, meta } = await pdfLines(buf);
    const textChars = lines.reduce((a, l) => a + l.text.length, 0);
    const pdfPath = path.join(dir, "in.pdf");
    await fs.writeFile(pdfPath, buf);
    const poppler = await hasBin("pdftoppm");
    if (!poppler) b.warnings.push("poppler-utils (pdftoppm) not installed: page images and embedded images are unavailable");
    if (poppler) {
      try {
        await exec("pdftoppm", ["-r", "110", "-png", "-l", "40", pdfPath, path.join(dir, "page")], { timeout: 60_000 });
        for (const f of (await fs.readdir(dir)).filter((x) => /^page-\d+\.png$/.test(x)).sort()) pageImages.push({ page: Number(f.match(/-(\d+)\.png/)![1]), buffer: await fs.readFile(path.join(dir, f)) });
      } catch { b.warnings.push("Could not render PDF pages"); }
    }
    let ocrUsed = false;
    if (textChars < 20 * Math.max(1, pages)) {
      // scanned / image-only PDF: OCR the rendered pages
      if (!pageImages.length) throw Object.assign(new Error("Scanned PDF needs page rendering (pdftoppm) and OCR"), { status: 422 });
      const hi = path.join(dir, "ocr");
      await exec("pdftoppm", ["-r", "200", "-png", "-l", "20", pdfPath, hi], { timeout: 120_000 });
      const files = (await fs.readdir(dir)).filter((x) => /^ocr-\d+\.png$/.test(x)).sort();
      const ocr = ocrProvider();
      const all: Line[] = [];
      for (const f of files) {
        const page = Number(f.match(/-(\d+)\.png/)![1]);
        const r = await ocr.recognize(await fs.readFile(path.join(dir, f)));
        r.lines.forEach((ln, i) => all.push({ y: 10000 - i * 14 - page * 100000, x: 0, size: 10, text: ln.text, bold: false, page }));
      }
      ocrUsed = true;
      b.warnings.push("Scanned document: text recognised by OCR and may contain errors. Verify every step against the original.");
      linesToBlocks(all, b);
      b.blocks.forEach((x) => (x.ocr = true));
    } else {
      linesToBlocks(lines, b);
      if (poppler) {
        try {
          await exec("pdfimages", ["-png", "-p", "-l", "40", pdfPath, path.join(dir, "img")], { timeout: 60_000 });
          for (const f of (await fs.readdir(dir)).filter((x) => /^img-\d+-\d+\.png$/.test(x)).sort()) {
            const page = Number(f.match(/img-(\d+)-/)![1]);
            const buffer = await fs.readFile(path.join(dir, f));
            if (buffer.length < 1500) continue; // decorative
            // Insert the image right after the last text block on its page so document order approximates layout order
            const idx = b.blocks.map((x) => x.page).lastIndexOf(page);
            const before = b.blocks.length;
            await b.addImage(buffer, "image/png", page);
            if (idx >= 0 && b.blocks.length > before) { const [im] = b.blocks.splice(b.blocks.length - 1, 1); b.blocks.splice(idx + 1, 0, im); }
          }
          b.blocks.forEach((x, i) => (x.order = i + 1));
        } catch { /* pdfimages optional */ }
      }
    }
    const control = detectDocControl(b.blocks.slice(0, 20).map((x) => x.text));
    return { partial: { metadata: meta, docControl: control, ocrUsed }, pageImages };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ---------- images (scans/screenshots) ----------
async function extractImage(buf: Buffer, mime: string, b: Builder): Promise<Partial<ExtractedDocument>> {
  await b.addImage(buf, mime);
  const png = await sharp(buf).png().toBuffer();
  const r = await ocrProvider().recognize(png);
  const lines: Line[] = r.lines.map((l, i) => ({ y: 10000 - i * 14, x: 0, size: 10, text: l.text, bold: false, page: 1 }));
  linesToBlocks(lines, b);
  b.blocks.forEach((x) => { if (x.type !== "image") x.ocr = true; });
  b.warnings.push(`Text recognised by OCR (mean confidence ${Math.round(r.confidence * 100)}%); verify against the original image.`);
  return { ocrUsed: true, docControl: detectDocControl(b.blocks.map((x) => x.text)) };
}

export async function extractDocument(buf: Buffer, kind: DetectedKind, filename: string): Promise<ExtractResult> {
  const b = new Builder();
  let partial: Partial<ExtractedDocument> = {};
  let pageImages: { page: number; buffer: Buffer }[] | undefined;
  switch (kind) {
    case "docx": partial = await extractDocx(buf, b); break;
    case "pptx": partial = await extractPptx(buf, b); break;
    case "html": partial = await extractHtml(buf.toString("utf8"), b); break;
    case "markdown": case "text": partial = await extractMarkdown(buf.toString("utf8"), b); break;
    case "pdf": { const r = await extractPdf(buf, b); partial = r.partial; pageImages = r.pageImages; break; }
    case "png": case "jpeg": case "webp": case "gif": partial = await extractImage(buf, `image/${kind}`, b); break;
  }
  const doc: ExtractedDocument = {
    kind, blocks: b.blocks, images: b.images, metadata: { title: path.basename(filename).replace(/\.[^.]+$/, ""), ...(partial.metadata ?? {}) },
    docControl: partial.docControl ?? {}, warnings: b.warnings, ocrUsed: partial.ocrUsed ?? false,
  };
  return { doc, imageBuffers: b.buffers, pageImages };
}
