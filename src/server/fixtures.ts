// Synthetic screenshots and sample documents for seed data, demos and tests. Nothing here is real customer data.
import sharp from "sharp";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A mock application window PNG with a titled header, a form and a primary button. */
export async function mockScreenshot(opts: { app: string; screen: string; button: string; fields?: string[]; width?: number; height?: number; seed?: number }): Promise<{ buf: Buffer; button: { x: number; y: number; w: number; h: number } }> {
  const W = opts.width ?? 960, H = opts.height ?? 600;
  const fields = opts.fields ?? ["Vendor", "Document type", "Amount"];
  const rows = fields.map((f, i) => `<text x="60" y="${170 + i * 70}" font-size="18" fill="#334155">${esc(f)}</text><rect x="260" y="${148 + i * 70}" width="420" height="40" rx="6" fill="#fff" stroke="#94a3b8"/>`).join("");
  const by = 170 + fields.length * 70 + 10;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="DejaVu Sans, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#f1f5f9"/><rect width="${W}" height="56" fill="#0f766e"/>
  <text x="24" y="36" font-size="22" fill="#fff" font-weight="700">${esc(opts.app)}</text>
  <text x="60" y="110" font-size="26" fill="#0f172a" font-weight="700">${esc(opts.screen)}</text>${rows}
  <rect x="260" y="${by}" width="160" height="46" rx="8" fill="#0f766e"/><text x="340" y="${by + 30}" font-size="18" fill="#fff" text-anchor="middle">${esc(opts.button)}</text></svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return { buf, button: { x: 260 / W, y: by / H, w: 160 / W, h: 46 / H } };
}

/** Minimal valid text PDF (no JS) for import tests. Lines are rendered with the Helvetica standard font. */
export function simplePdf(lines: string[]): Buffer {
  const esc2 = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  let content = "BT /F1 11 Tf 50 780 Td 15 TL\n";
  for (const l of lines) content += `(${esc2(l)}) Tj T*\n`;
  content += "ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
