// Upload validation: allowlist by *detected* content type (magic bytes), size caps, archive-bomb limits,
// macro/JS rejection and a pluggable malware scanner. Filenames and declared MIME types are never trusted.
import { fileTypeFromBuffer } from "file-type";
import JSZip from "jszip";
import net from "node:net";
import path from "node:path";
import { env } from "./env";
import { AppError } from "./errors";

export type DetectedKind = "png" | "jpeg" | "webp" | "gif" | "pdf" | "docx" | "pptx" | "html" | "markdown" | "text";

export interface Validated {
  kind: DetectedKind;
  mime: string;
  ext: string;
}

const MAX_BYTES = { image: 15 * 1024 * 1024, doc: 30 * 1024 * 1024, text: 5 * 1024 * 1024 };
const MAX_ZIP_ENTRIES = 5000;
const MAX_ZIP_UNCOMPRESSED = 300 * 1024 * 1024;

const MIME: Record<DetectedKind, string> = {
  png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  html: "text/html", markdown: "text/markdown", text: "text/plain",
};

const reject = (msg: string, code = "upload_rejected") => new AppError(422, code, msg);

/** Built-in signature scanner (EICAR + dangerous document features). NOT a substitute for a real AV engine. */
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export interface ScanResult { clean: boolean; reason?: string }
export async function scanBuffer(buf: Buffer): Promise<ScanResult> {
  if (env().MALWARE_SCANNER === "clamav" && env().CLAMAV_HOST) return clamScan(buf);
  if (buf.includes(Buffer.from(EICAR))) return { clean: false, reason: "EICAR test signature detected" };
  return { clean: true };
}

async function clamScan(buf: Buffer): Promise<ScanResult> {
  return new Promise((resolve, reject_) => {
    const sock = net.createConnection({ host: env().CLAMAV_HOST!, port: env().CLAMAV_PORT });
    let out = "";
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      const CH = 64 * 1024;
      for (let i = 0; i < buf.length; i += CH) {
        const chunk = buf.subarray(i, i + CH);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));
    });
    sock.on("data", (d) => (out += d.toString()));
    sock.on("end", () => resolve(out.includes("FOUND") ? { clean: false, reason: out.trim() } : { clean: true }));
    sock.on("error", (e) => reject_(new AppError(503, "scanner_unavailable", `Malware scanner unavailable: ${e.message}`)));
    sock.setTimeout(30_000, () => sock.destroy(new Error("timeout")));
  });
}

function isProbablyText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.subarray(0, sample.length - 3 > 0 ? sample.length - 3 : sample.length));
    return true;
  } catch {
    return false;
  }
}

async function inspectZip(buf: Buffer, requirePrefix: string) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw reject("File is not a valid Office document archive");
  }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ZIP_ENTRIES) throw reject("Archive has too many entries");
  let total = 0;
  for (const n of names) {
    const size = (zip.files[n] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    total += size;
    if (n.includes("..") || n.startsWith("/")) throw reject("Archive contains unsafe paths");
  }
  if (total > MAX_ZIP_UNCOMPRESSED) throw reject("Archive expands beyond the permitted size (possible zip bomb)");
  if (names.some((n) => /vbaProject\.bin$/i.test(n))) throw reject("Macro-enabled Office documents are not accepted");
  if (names.some((n) => /(^|\/)embeddings\/.+\.(exe|dll|bat|js|vbs)$/i.test(n))) throw reject("Embedded executables are not accepted");
  if (!names.some((n) => n.startsWith(requirePrefix))) throw reject("Document structure not recognised");
}

export async function validateUpload(buf: Buffer, filename: string, opts: { allow: DetectedKind[] }): Promise<Validated> {
  if (buf.length === 0) throw reject("File is empty");
  const ext = path.extname(filename).toLowerCase().replace(".", "");
  const ft = await fileTypeFromBuffer(buf);
  let kind: DetectedKind | null = null;

  if (ft) {
    switch (ft.ext) {
      case "png": kind = "png"; break;
      case "jpg": kind = "jpeg"; break;
      case "webp": kind = "webp"; break;
      case "gif": kind = "gif"; break;
      case "pdf": kind = "pdf"; break;
      case "docx": kind = "docx"; break;
      case "pptx": kind = "pptx"; break;
      case "cfb": throw reject("Legacy binary Office formats (.doc/.ppt) are not supported. Save as .docx/.pptx and re-upload.");
      default: throw reject(`File type '${ft.ext}' is not accepted`);
    }
  } else if (isProbablyText(buf)) {
    if (["html", "htm"].includes(ext)) kind = "html";
    else if (["md", "markdown"].includes(ext)) kind = "markdown";
    else if (ext === "txt") kind = "text";
    else throw reject("Unrecognised file content");
  } else throw reject("Unrecognised or binary file content");

  if (!opts.allow.includes(kind)) throw reject(`${kind.toUpperCase()} files are not accepted here`);

  // extension must be consistent with detected content
  const extOk: Record<DetectedKind, string[]> = {
    png: ["png"], jpeg: ["jpg", "jpeg"], webp: ["webp"], gif: ["gif"], pdf: ["pdf"], docx: ["docx"], pptx: ["pptx"],
    html: ["html", "htm"], markdown: ["md", "markdown"], text: ["txt"],
  };
  if (!extOk[kind].includes(ext)) throw reject(`File extension .${ext || "(none)"} does not match its content (${kind})`);

  const cap = ["png", "jpeg", "webp", "gif"].includes(kind) ? MAX_BYTES.image : ["html", "markdown", "text"].includes(kind) ? MAX_BYTES.text : MAX_BYTES.doc;
  if (buf.length > cap) throw reject(`File exceeds the ${Math.round(cap / 1048576)} MB limit`, "upload_too_large");

  if (kind === "docx") await inspectZip(buf, "word/");
  if (kind === "pptx") await inspectZip(buf, "ppt/");
  if (kind === "pdf") {
    const head = buf.toString("latin1");
    if (/\/(JavaScript|JS|Launch)\b/.test(head)) throw reject("PDFs containing JavaScript or launch actions are not accepted");
  }
  const scan = await scanBuffer(buf);
  if (!scan.clean) throw reject(`Malware scan failed: ${scan.reason}`, "malware_detected");

  return { kind, mime: MIME[kind], ext };
}
