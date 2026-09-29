// Inventory and import an AUTHORISED folder of legacy documents.
//   npm run import:folder -- ./legacy-docs --as alice@contoso.example --dry-run
//   npm run import:folder -- ./legacy-docs --as alice@contoso.example --inventory-only
// Source files are only ever read. Nothing is deleted, moved or overwritten.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { prisma } from "../src/server/db";
import { ctxForUserId } from "../src/server/session";
import { createImports, getBatch } from "../src/server/services/imports";
import { drainJobs } from "../src/server/jobs";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--as");
const asEmail = args[args.indexOf("--as") + 1];
const dryRun = args.includes("--dry-run"), inventoryOnly = args.includes("--inventory-only");
if (!dir || !asEmail) { console.error("usage: import-folder <dir> --as <author-email> [--dry-run] [--inventory-only]"); process.exit(2); }

const EXT = new Set([".docx", ".pdf", ".pptx", ".html", ".htm", ".md", ".markdown", ".txt", ".png", ".jpg", ".jpeg"]);
async function walk(d: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...(await walk(p))); else if (EXT.has(path.extname(e.name).toLowerCase())) out.push(p); }
  return out;
}
const files = await walk(path.resolve(dir));
const inv = await Promise.all(files.map(async (f) => { const b = await fs.readFile(f); return { file: path.relative(dir, f), size: b.length, sha256: createHash("sha256").update(b).digest("hex"), buffer: b }; }));
const bySha = new Map<string, string[]>();
for (const i of inv) bySha.set(i.sha256, [...(bySha.get(i.sha256) ?? []), i.file]);
console.log(`Inventory: ${inv.length} file(s), ${[...bySha.values()].filter((v) => v.length > 1).length} exact-duplicate group(s)`);
for (const [sha, list] of bySha) if (list.length > 1) console.log(`  duplicate ${sha.slice(0, 8)}: ${list.join(", ")}`);
if (!inventoryOnly) {
  const user = await prisma.user.findFirstOrThrow({ where: { email: asEmail.toLowerCase(), active: true } });
  const ctx = await ctxForUserId(user.id, "system");
  const r = await createImports(ctx, inv.map((i) => ({ name: path.basename(i.file), buffer: i.buffer })), { batchName: `Folder ${path.basename(dir)}`, dryRun });
  await drainJobs();
  const b = await getBatch(ctx, r.batchId);
  console.log("Reconciliation:", JSON.stringify(b.totals));
  console.log(`Batch ${r.batchId}: open /imports/batches/${r.batchId} in the app for the exception report.`);
}
await prisma.$disconnect();
