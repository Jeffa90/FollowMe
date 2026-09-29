// Server-side screenshot processing: crop, annotate/flatten, burned-in redaction.
// Redaction (blur) is destructive in the rendered output: learners never receive the pixels underneath.
import sharp from "sharp";
import { createHash } from "node:crypto";
import type { Annotation } from "../lib/guide-schema";

const COLORS = { box: "#e11d48", arrow: "#e11d48", highlight: "#facc15", marker: "#2563eb" };

function svgFor(anns: Annotation[], W: number, H: number): string {
  const parts: string[] = [];
  const sw = Math.max(3, Math.round(Math.min(W, H) / 250));
  for (const a of anns) {
    const x = a.x * W, y = a.y * H, w = (a.w ?? 0) * W, h = (a.h ?? 0) * H;
    if (a.kind === "box") parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="none" stroke="${COLORS.box}" stroke-width="${sw}"/>`);
    else if (a.kind === "highlight") parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${COLORS.highlight}" fill-opacity="0.38"/>`);
    else if (a.kind === "arrow") {
      const x2 = (a.x2 ?? a.x) * W, y2 = (a.y2 ?? a.y) * H;
      const ang = Math.atan2(y2 - y, x2 - x), L = sw * 5;
      const p1 = [x2 - L * Math.cos(ang - 0.45), y2 - L * Math.sin(ang - 0.45)];
      const p2 = [x2 - L * Math.cos(ang + 0.45), y2 - L * Math.sin(ang + 0.45)];
      parts.push(`<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${COLORS.arrow}" stroke-width="${sw}" stroke-linecap="round"/>`);
      parts.push(`<polygon points="${x2},${y2} ${p1.join(",")} ${p2.join(",")}" fill="${COLORS.arrow}"/>`);
    } else if (a.kind === "marker") {
      const r = sw * 5;
      parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${COLORS.marker}" stroke="#fff" stroke-width="2"/>`);
      parts.push(`<text x="${x}" y="${y + r * 0.35}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${r * 1.1}" font-weight="700" text-anchor="middle" fill="#fff">${a.n ?? 1}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join("")}</svg>`;
}

/** Flatten annotations onto an image. Blur regions are applied first (pixelation), so later shapes draw on top. */
export async function renderAnnotated(input: Buffer, anns: Annotation[], opts: { maxWidth?: number } = {}): Promise<Buffer> {
  let img = sharp(input, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  if (!W || !H) throw new Error("Unreadable image");
  let base = await img.png().toBuffer();

  const blurs = anns.filter((a) => a.kind === "blur" && a.w && a.h);
  if (blurs.length) {
    const overlays: import("sharp").OverlayOptions[] = [];
    for (const a of blurs) {
      const left = Math.max(0, Math.round(a.x * W)), top = Math.max(0, Math.round(a.y * H));
      const width = Math.min(W - left, Math.max(2, Math.round(a.w! * W))), height = Math.min(H - top, Math.max(2, Math.round(a.h! * H)));
      if (width < 2 || height < 2) continue;
      const block = Math.max(10, Math.round(Math.min(width, height) / 3));
      const small = await sharp(base).extract({ left, top, width, height }).resize(Math.max(1, Math.round(width / block)), Math.max(1, Math.round(height / block)), { kernel: "nearest" }).blur(1.5).png().toBuffer();
      const pix = await sharp(small).resize(width, height, { kernel: "nearest" }).modulate({ brightness: 0.85 }).png().toBuffer();
      overlays.push({ input: pix, left, top });
    }
    if (overlays.length) base = await sharp(base).composite(overlays).png().toBuffer();
  }
  const shapes = anns.filter((a) => a.kind !== "blur");
  if (shapes.length) base = await sharp(base).composite([{ input: Buffer.from(svgFor(shapes, W, H)), top: 0, left: 0 }]).png().toBuffer();
  if (opts.maxWidth && W > opts.maxWidth) base = await sharp(base).resize({ width: opts.maxWidth }).png().toBuffer();
  return base;
}

export async function cropImage(input: Buffer, r: { x: number; y: number; w: number; h: number }): Promise<{ buf: Buffer; width: number; height: number }> {
  const meta = await sharp(input).metadata();
  const W = meta.width!, H = meta.height!;
  const left = Math.max(0, Math.round(r.x * W)), top = Math.max(0, Math.round(r.y * H));
  const width = Math.min(W - left, Math.round(r.w * W)), height = Math.min(H - top, Math.round(r.h * H));
  if (width < 8 || height < 8) throw new Error("Crop area too small");
  const buf = await sharp(input).extract({ left, top, width, height }).png().toBuffer();
  return { buf, width, height };
}

export async function imageInfo(input: Buffer) {
  const m = await sharp(input, { failOn: "none" }).metadata();
  return { width: m.width ?? null, height: m.height ?? null };
}

export const annotationsHash = (anns: Annotation[]) => createHash("sha1").update(JSON.stringify(anns)).digest("hex").slice(0, 12);
