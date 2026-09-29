import { createHash } from "node:crypto";
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}
export const contentHash = (content: unknown) => createHash("sha256").update(canonical(content)).digest("hex");
export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
