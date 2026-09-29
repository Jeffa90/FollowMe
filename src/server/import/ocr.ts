// OCR abstraction. Default: Tesseract CLI. Set OCR_PROVIDER=none to disable (scanned documents are then rejected with a clear message).
import { spawn } from "node:child_process";
import { env } from "../env";
import { AppError } from "../errors";

export interface OcrResult { text: string; confidence: number; lines: { text: string; confidence: number }[] }
export interface OcrOptions { /** Sparse mode finds isolated labels (buttons, fields) rather than flowing paragraphs. */ sparse?: boolean }
export interface OcrProvider { name: string; recognize(image: Buffer, opts?: OcrOptions): Promise<OcrResult> }

class TesseractCli implements OcrProvider {
  name = "tesseract";
  recognize(image: Buffer, opts: OcrOptions = {}): Promise<OcrResult> {
    return new Promise((resolve, reject) => {
      const p = spawn("tesseract", ["stdin", "stdout", "--psm", opts.sparse ? "11" : "6", "tsv"], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", (e) => reject(new AppError(503, "ocr_unavailable", `OCR engine not available: ${e.message}`)));
      p.on("close", (code) => {
        if (code !== 0) return reject(new AppError(422, "ocr_failed", `OCR failed: ${err.slice(0, 200)}`));
        // TSV columns: level page block par line word left top width height conf text
        const rows = out.split("\n").slice(1).map((l) => l.split("\t")).filter((c) => c.length >= 12 && c[0] === "5" && c[11].trim());
        const byLine = new Map<string, { words: string[]; confs: number[] }>();
        for (const c of rows) {
          const k = `${c[2]}-${c[3]}-${c[4]}`;
          const e = byLine.get(k) ?? { words: [], confs: [] };
          e.words.push(c[11]); e.confs.push(Math.max(0, Number(c[10])));
          byLine.set(k, e);
        }
        const lines = [...byLine.values()].map((l) => ({ text: l.words.join(" "), confidence: l.confs.reduce((a, b) => a + b, 0) / l.confs.length / 100 }));
        const all = lines.flatMap((l) => l);
        resolve({ text: lines.map((l) => l.text).join("\n"), confidence: all.length ? all.reduce((a, l) => a + l.confidence, 0) / all.length : 0, lines });
      });
      p.stdin.end(image);
    });
  }
}
class NoOcr implements OcrProvider {
  name = "none";
  async recognize(): Promise<OcrResult> { throw new AppError(422, "ocr_disabled", "This document needs OCR (it is scanned or an image) but OCR is not enabled."); }
}
let ocr: OcrProvider | undefined;
export const ocrProvider = (): OcrProvider => (ocr ??= env().OCR_PROVIDER === "none" ? new NoOcr() : new TesseractCli());
export const setOcrProviderForTests = (p: OcrProvider | undefined) => { ocr = p; };
