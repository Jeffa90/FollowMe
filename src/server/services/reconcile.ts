// Edited-export reconciliation. Exports are copies, not masters: if someone edits a downloaded Word copy and uploads it, the
// changes are COMPARED with the controlled source and can only enter the system as a NEW DRAFT REVISION that goes through
// the normal review/approval workflow. Nothing is accepted automatically.
// Scope: FollowMe-generated DOCX files (control marker in the header). Purpose, scope, audience, expected result and the
// numbered procedure steps (title + text) are compared. Images, tables and unnumbered notes are not reconciled (see docs/known-limitations.md).
import * as cheerio from "cheerio";
import JSZip from "jszip";
import mammoth from "mammoth";
import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { hasRole } from "../ctx";
import { forbidden, conflict, notFound, unprocessable } from "../errors";
import { storeAsset, assetBuffer } from "./assets";
import { loadGuide, getVersionDetail, startRevision, saveContent } from "./guides";
import { canEditContent, isOwnerOrAdmin } from "../authz";
import { guideContentSchema, numberSteps, stripInline, type GuideContent } from "../../lib/guide-schema";

const MARKER = /FOLLOWME-CONTROL\s+(\S+)\s+v(\S+)\s+([0-9a-f]{12})/;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

interface ParsedExport { marker: { documentId: string; version: string; hash: string } | null; fields: Partial<Record<"purpose" | "scope" | "audience" | "expectedResult", string>>; steps: { number: string; title: string; text: string }[] }

export async function parseEditedDocx(buf: Buffer): Promise<ParsedExport> {
  const zip = await JSZip.loadAsync(buf);
  let marker: ParsedExport["marker"] = null;
  for (const n of Object.keys(zip.files).filter((f) => /^word\/(header|footer)\d*\.xml$/.test(f))) {
    const m = MARKER.exec((await zip.files[n].async("string")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    if (m) marker = { documentId: m[1], version: m[2], hash: m[3] };
  }
  const html = (await mammoth.convertToHtml({ buffer: buf })).value;
  const $ = cheerio.load(html);
  const fields: ParsedExport["fields"] = {};
  const steps: ParsedExport["steps"] = [];
  let section = "";
  const map: Record<string, keyof ParsedExport["fields"]> = { purpose: "purpose", scope: "scope", audience: "audience", "expected result": "expectedResult" };
  let cur: ParsedExport["steps"][number] | null = null;
  for (const el of $("body").children().toArray()) {
    const n = $(el); const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    if (tag === "h2") { section = norm(n.text()).toLowerCase(); cur = null; continue; }
    if (tag !== "p") continue;
    const text = norm(n.text());
    if (!text) continue;
    if (section === "procedure") {
      const m = /^(\d+(?:\.[A-Z]\.\d+)*)\.\s+(.+)$/.exec(text);
      if (m && norm(n.children("strong").first().text()).startsWith(m[1] + ".")) { cur = { number: m[1], title: norm(m[2]), text: "" }; steps.push(cur); continue; }
      if (/^(Location:|Equipment:|When:|If:)/.test(text) || /^(Warning|Note|Tip|Control|Expected result|Reusable block):/.test(text)) { cur = null; continue; }
      if (cur) cur.text = [cur.text, text].filter(Boolean).join("\n");
    } else if (map[section]) fields[map[section]] = [fields[map[section]], text].filter(Boolean).join("\n");
  }
  return { marker, fields, steps };
}

export interface Change { kind: "field" | "step"; id: string; label: string; before: string; after: string }

export async function analyzeEditedExport(ctx: Ctx, guideId: string, file: { name: string; buffer: Buffer }) {
  const g = await loadGuide(ctx, guideId);
  if (!(canEditContent(ctx, g) || isOwnerOrAdmin(ctx, g))) throw forbidden();
  if (!g.liveVersionId) throw conflict("Only published guides have controlled exports to reconcile against");
  const asset = await storeAsset(ctx, { buffer: file.buffer, filename: file.name, purpose: "IMPORT_SOURCE", allow: ["docx"], guideId: g.id });
  const parsed = await parseEditedDocx(file.buffer);
  const problems: string[] = [];
  if (!parsed.marker) problems.push("This file has no FollowMe control marker: it does not look like an export of a controlled guide. It cannot be reconciled automatically; use Import instead.");
  else if (parsed.marker.documentId !== g.documentId) problems.push(`The control marker refers to ${parsed.marker.documentId}, not ${g.documentId}.`);
  const base = parsed.marker ? await prisma.guideVersion.findFirst({ where: { guideId: g.id, label: parsed.marker.version } }) : null;
  if (parsed.marker && !base) problems.push(`Version ${parsed.marker.version} is unknown for this guide.`);
  if (base && !base.contentHash.startsWith(parsed.marker!.hash)) problems.push("The control hash does not match version " + base.label + ": the marker was altered.");
  const live = await prisma.guideVersion.findUniqueOrThrow({ where: { id: g.liveVersionId } });
  const stale = !!base && base.id !== live.id;
  if (stale) problems.push(`The export was made from version ${base!.label}, but the current live version is ${live.label}. Re-export the current version and re-apply your edits.`);
  const changes: Change[] = [];
  if (base && !problems.some((p) => p.startsWith("The control"))) {
    const c = guideContentSchema.parse(base.content);
    for (const k of ["purpose", "scope", "audience", "expectedResult"] as const) {
      const after = parsed.fields[k]; if (after === undefined && !c[k]) continue;
      if (norm(after ?? "") !== norm(stripInline(c[k]))) changes.push({ kind: "field", id: k, label: k, before: c[k], after: after ?? "" });
    }
    const top = numberSteps(c.steps).filter((n) => n.depth === 0 && n.number && ["action", "physical", "decision", "exception"].includes(n.step.kind));
    for (const ps of parsed.steps.filter((p) => !p.number.includes("."))) {
      const b = top.find((t) => t.number === ps.number);
      if (!b) { changes.push({ kind: "step", id: `new:${ps.number}`, label: `Step ${ps.number} (added in the edited copy; cannot be applied automatically)`, before: "", after: `${ps.title} ${ps.text}`.trim() }); continue; }
      if (norm(stripInline(b.step.title)) !== ps.title || norm(stripInline(b.step.text).replace(/\n/g, " ")) !== norm(ps.text.replace(/\n/g, " "))) changes.push({ kind: "step", id: b.step.id, label: `Step ${ps.number}`, before: [b.step.title, b.step.text].filter(Boolean).join(" / "), after: [ps.title, ps.text].filter(Boolean).join(" / ") });
    }
    for (const t of top) if (!parsed.steps.some((p) => p.number === t.number)) changes.push({ kind: "step", id: `removed:${t.step.id}`, label: `Step ${t.number} (missing from the edited copy; not applied)`, before: t.step.title, after: "" });
  }
  await audit(ctx, null, { action: "EDITED_EXPORT_UPLOADED", entityType: "Guide", entityId: g.id, guideId: g.id, summary: `Edited export uploaded for ${g.documentId}: ${changes.length} difference(s), ${problems.length} problem(s)`, detail: { assetId: asset.id, problems } });
  return { assetId: asset.id, controlFound: !!parsed.marker, baseVersionId: base?.id ?? null, baseVersionLabel: base?.label ?? null, currentVersionLabel: live.label, stale, problems, changes, applicable: !problems.length };
}

const applySchema = z.object({ assetId: z.string(), accept: z.array(z.string()).min(1).max(200), summary: z.string().max(1000).default("") });
/** Accepted changes become a NEW DRAFT REVISION (source RECONCILIATION). It must still be reviewed, approved and published. */
export async function applyReconciliation(ctx: Ctx, guideId: string, input: unknown) {
  const { assetId, accept, summary } = applySchema.parse(input);
  const g = await loadGuide(ctx, guideId);
  if (!(canEditContent(ctx, g) || isOwnerOrAdmin(ctx, g))) throw forbidden();
  const { buffer, asset } = await assetBuffer(ctx.orgId, assetId);
  if (asset.purpose !== "IMPORT_SOURCE" || asset.guideId !== g.id) throw notFound("Upload");
  const a = await analyzeEditedExport(ctx, guideId, { name: asset.originalName, buffer }).catch((e) => { throw e; });
  if (!a.applicable) throw unprocessable("The edited export cannot be reconciled", a.problems);
  const chosen = a.changes.filter((c) => accept.includes(c.id) && !c.id.startsWith("new:") && !c.id.startsWith("removed:"));
  if (!chosen.length) throw unprocessable("None of the selected changes can be applied automatically");
  const rev = await startRevision(ctx, guideId, { summary: summary || `Reconciled ${chosen.length} edit(s) from an uploaded copy of v${a.baseVersionLabel}: ${chosen.map((c) => c.label).join(", ")}` });
  await prisma.guideVersion.update({ where: { id: rev.id }, data: { source: "RECONCILIATION", sourceRef: assetId } });
  const d = await getVersionDetail(ctx, rev.id);
  const c: GuideContent = JSON.parse(JSON.stringify(d.content));
  for (const ch of chosen) {
    if (ch.kind === "field") (c as Record<string, unknown>)[ch.id] = ch.after;
    else { const step = numberSteps(c.steps).find((n) => n.step.id === ch.id)?.step; if (step) { const [title, ...rest] = ch.after.split(" / "); step.title = title; step.text = rest.join(" / "); step.origin = { ...step.origin, flags: [...step.origin.flags, { code: "reconciled-edit", message: "Text changed from an edited export copy; verify before approval.", severity: "info" }] }; } }
  }
  await saveContent(ctx, rev.id, c, d.rev);
  await audit(ctx, null, { action: "RECONCILIATION_DRAFT_CREATED", entityType: "GuideVersion", entityId: rev.id, guideId: g.id, versionId: rev.id, summary: `Draft v${rev.label} created from ${chosen.length} reconciled edit(s); approval required`, detail: { accepted: chosen.map((x) => x.label), assetId } });
  void hasRole;
  return { versionId: rev.id, applied: chosen.length, skipped: a.changes.length - chosen.length };
}
