// AI/rules assistance on a DRAFT: produces SUGGESTIONS stored separately from content. Nothing here edits a guide;
// a person must accept each suggestion. All local implementations are deterministic and never invent facts.
import { z } from "zod";
import { prisma } from "../db";
import type { Ctx } from "../ctx";
import { forbidden, notFound, unprocessable } from "../errors";
import { getVersionDetail } from "../services/guides";
import { createSuggestions, type SuggestionInput } from "../services/suggestions";
import { assetBuffer } from "../services/assets";
import { ocrProvider } from "../import/ocr";
import { gate } from "./policy";
import { buildTaskPrompt, PROMPT_VERSIONS, SYSTEM_BASE, type PromptId } from "./prompts";
import { audit } from "../audit";
import { flattenSteps, numberSteps, stepPlainText, stripInline, type GuideContent, type Step } from "../../lib/guide-schema";
import { renderAnnotated } from "../imaging";
import sharp from "sharp";

export const TASKS = ["suggest_missing", "terms", "rewrite_step", "mismatch", "quiz", "faq", "summary", "translate"] as const;
export type TaskName = (typeof TASKS)[number];
const PROMPT_FOR: Record<TaskName, PromptId | null> = { suggest_missing: "suggest_missing@1", terms: "terms@1", rewrite_step: "rewrite_step@1", mismatch: null, quiz: "quiz@1", faq: "faq@1", summary: "summary@1", translate: "translate@1" };
const DESTRUCTIVE = /\b(delete|remove|cancel|submit|approve|post|send|pay|confirm|publish|reject|discard|terminate|release|save)\b/i;

function localSuggestMissing(c: GuideContent): SuggestionInput[] {
  const out: SuggestionInput[] = [];
  const steps = flattenSteps(c.steps);
  const hasWarning = (idx: number) => steps.slice(Math.max(0, idx - 1), idx + 2).some((s) => s.kind === "warning" || s.kind === "control");
  steps.forEach((s, i) => {
    if (s.kind === "action" && /\b(delete|remove|cancel|discard|terminate|reject|release)\b/i.test(`${s.title} ${s.text}`) && !hasWarning(i))
      out.push({ kind: "warning", stepId: s.id, payload: { text: `Check before you ${stripInline(s.title || s.text).toLowerCase().slice(0, 60)}: this action may be difficult to reverse.` }, uncertainty: { reason: "The step looks destructive and has no nearby warning. Confirm the real consequence before accepting.", confidence: "low" } });
  });
  const commit = steps.findIndex((s) => s.kind === "action" && /\b(save|submit|post|create|confirm)\b/i.test(s.title));
  if (commit >= 0 && c.validationChecks.length === 0) out.push({ kind: "validation", stepId: steps[commit].id, payload: { text: "Confirm that a success message or the expected result appears after saving/submitting." }, uncertainty: { reason: "No validation checks are defined and the procedure ends in a commit action.", confidence: "medium" } });
  const text = steps.map(stepPlainText).join(" ");
  if (/\bSAP\b|transaction/i.test(text) && !c.prerequisites.some((p) => /access|role|authori/i.test(p))) out.push({ kind: "prerequisite", payload: { text: "Access to the system with the role required for this task (role to be confirmed by the process owner)." }, uncertainty: { reason: "The guide mentions a system but lists no access prerequisite. The exact role is NOT known: edit it before accepting.", confidence: "low" } });
  return out;
}

async function localTerms(orgId: string, c: GuideContent): Promise<SuggestionInput[]> {
  const out: SuggestionInput[] = [];
  const reg = await prisma.synonym.findMany({ where: { orgId } });
  const acr = reg.filter((r) => r.kind === "ACRONYM");
  const text = flattenSteps(c.steps).map(stepPlainText).join(" ") + " " + c.purpose + " " + c.scope;
  const defined = new Set(c.acronyms.map((a) => a.term.toUpperCase()));
  for (const a of acr) if (!defined.has(a.term.toUpperCase()) && new RegExp(`\\b${a.term}\\b`).test(text)) out.push({ kind: "acronym", payload: { term: a.term, expansion: a.expansions[0] ?? "" }, uncertainty: { reason: "From the organisation's acronym register." } });
  for (const g of reg.filter((r) => r.kind === "SYNONYM")) {
    const forms = [g.term, ...g.expansions].filter((f) => f.length > 3);
    const used = forms.filter((f) => new RegExp(`\\b${f}\\b`, "i").test(text));
    if (used.length > 1) out.push({ kind: "term", payload: { text: `Inconsistent terms for the same thing: ${used.map((u) => `"${u}"`).join(", ")}. Consider using "${g.term}" throughout.` }, uncertainty: { reason: "From the organisation's synonym register." } });
  }
  return out;
}

const TIGHTEN: [RegExp, string][] = [[/^(please|kindly)\s+/i, ""], [/^(you (should|must|need to|have to|will need to)|the user (should|must|needs to|shall)|the operator (should|must|shall))\s+/i, ""], [/\bclick on\b/gi, "click"], [/\bin order to\b/gi, "to"], [/\s{2,}/g, " "]];
function localRewrite(step: Step): SuggestionInput[] {
  const tighten = (s: string) => { let o = s.trim(); for (const [re, rep] of TIGHTEN) o = o.replace(re, rep); return o.charAt(0).toUpperCase() + o.slice(1); };
  const title = tighten(step.title), text = step.text.split("\n").map(tighten).join("\n");
  if (title === step.title && text === step.text) return [];
  return [{ kind: "rewrite", stepId: step.id, payload: { title, text, before: { title: step.title, text: step.text } }, uncertainty: { reason: "Mechanical plain-language tightening only (filler and modal verbs removed). Meaning is unchanged; check the result." } }];
}

/** Deterministic check that on-screen labels named in the step also appear in its (unannotated) screenshot, via local OCR. Screenshots never leave the server. */
async function localMismatch(ctx: Ctx, c: GuideContent): Promise<SuggestionInput[]> {
  const out: SuggestionInput[] = [];
  const ocr = ocrProvider();
  const alnum = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const readAll = async (img: Buffer, sparse: boolean) => {
    const meta = await sharp(img).metadata();
    const g = sharp(img).greyscale().resize({ width: Math.min(3200, (meta.width ?? 800) * (sparse ? 4 : 2)) }).normalise();
    const [a, b] = await Promise.all([g.clone().png().toBuffer(), g.clone().negate().png().toBuffer()]);
    const rs = await Promise.all([ocr.recognize(a, { sparse }), ocr.recognize(b, { sparse })]);
    return { text: rs.map((r) => r.text).join("\n"), confidence: Math.max(...rs.map((r) => r.confidence)) };
  };
  for (const s of flattenSteps(c.steps).filter((x) => x.image && x.kind === "action").slice(0, 8)) {
    const labels = [...`${s.title} ${s.text}`.matchAll(/\*\*([^*]{3,40})\*\*/g)].map((m) => m[1]);
    if (!labels.length) continue;
    const { buffer } = await assetBuffer(ctx.orgId, s.image!.assetId);
    const png = await renderAnnotated(buffer, s.image!.annotations.filter((a) => a.kind === "blur"), {}); // burned-in redactions only; no other overlays
    const meta = await sharp(png).metadata();
    const W = meta.width ?? 1, H = meta.height ?? 1;
    // Text inside the highlighted region (single-line mode) plus the whole screenshot (sparse mode).
    const texts: string[] = [];
    let conf = 0;
    for (const a of s.image!.annotations.filter((x) => x.kind === "box" || x.kind === "highlight").slice(0, 3)) {
      const padX = (a.w ?? 0.1) * 0.15, padY = (a.h ?? 0.05) * 0.3;
      const rect = { left: Math.max(0, Math.round((a.x - padX) * W)), top: Math.max(0, Math.round((a.y - padY) * H)), width: 0, height: 0 };
      rect.width = Math.min(W - rect.left, Math.round(((a.w ?? 0.1) + padX * 2) * W)); rect.height = Math.min(H - rect.top, Math.round(((a.h ?? 0.05) + padY * 2) * H));
      if (rect.width < 8 || rect.height < 8) continue;
      const crop = await sharp(png).extract(rect).png().toBuffer();
      const g = sharp(crop).greyscale().resize({ width: rect.width * 4 }).normalise();
      const variants = await Promise.all([g.clone().png().toBuffer(), g.clone().negate().png().toBuffer()]);
      const rs = await Promise.all(variants.map(async (v) => { const padded = await sharp(v).extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#ffffff" }).png().toBuffer(); return ocr.recognize(padded, { sparse: false }).catch(() => ({ text: "", confidence: 0, lines: [] })); }));
      for (const r of rs) { texts.push(r.text); conf = Math.max(conf, r.confidence); }
    }
    const whole = await readAll(png, true);
    texts.push(whole.text); conf = Math.max(conf, whole.confidence);
    const seen = alnum(texts.join(" "));
    for (const l of labels) if (!seen.includes(alnum(l))) out.push({ kind: "mismatch", stepId: s.id, payload: { text: `The step mentions "${l}" but that text was not found in the screenshot${s.image!.annotations.some((a) => a.kind === "box") ? " or its highlighted area" : ""} (OCR, ${Math.round(conf * 100)}% mean confidence). The screenshot may show an older or different screen.` }, uncertainty: { reason: "OCR can misread text; treat this as a prompt to look, not a verdict.", ocrConfidence: conf } });
  }
  return out;
}

function localQuiz(c: GuideContent): SuggestionInput[] {
  const out: SuggestionInput[] = [];
  for (const s of flattenSteps(c.steps).filter((x) => x.kind === "warning" || x.kind === "control").slice(0, 3)) {
    const t = stripInline(s.text || s.title);
    out.push({ kind: "quiz", stepId: s.id, payload: { question: `True or false: ${t.replace(/\.$/, "")}.`, options: ["True", "False"], correctIndex: 0 }, uncertainty: { reason: "A true/false comprehension check built from the guide's own warning text. Review the wording before accepting." } });
  }
  return out;
}
function localFaq(c: GuideContent): SuggestionInput[] {
  const out: SuggestionInput[] = c.troubleshooting.filter((t) => t.problem && t.resolution).slice(0, 5).map((t) => ({ kind: "faq" as const, payload: { text: `Q: ${t.problem}\nA: ${t.resolution}` }, uncertainty: { reason: "Taken from the guide's troubleshooting table." } }));
  return out;
}
function localSummary(c: GuideContent): SuggestionInput[] {
  const n = numberSteps(c.steps).filter((x) => x.number && x.depth === 0);
  return [{ kind: "summary", payload: { text: `${c.purpose ? c.purpose + " " : ""}${n.length} steps${n[0] ? `, starting with "${stripInline(n[0].step.title || n[0].step.text).slice(0, 70)}"` : ""}${c.expectedResult ? `. Expected result: ${c.expectedResult}` : ""}` }, uncertainty: { reason: "Assembled from the guide's purpose, first step and expected result." } }];
}

const listSchema = z.object({ suggestions: z.array(z.object({ kind: z.string(), text: z.string().max(1000), reason: z.string().max(500).default("") })).max(12) });
const rewriteSchema = z.object({ title: z.string().max(300), text: z.string().max(4000), uncertainty: z.string().max(500).default("") });
const textSchema = z.object({ text: z.string().max(4000) });
const itemsSchema = z.object({ items: z.array(z.object({ question: z.string().max(500), answer: z.string().max(1500).optional(), options: z.array(z.string().max(300)).max(6).optional(), correctIndex: z.number().int().optional() })).max(5) });

export async function runSuggestionTask(ctx: Ctx, versionId: string, task: TaskName, opts: { stepId?: string; language?: string } = {}) {
  const d = await getVersionDetail(ctx, versionId);
  if (!d.canEdit) throw forbidden("Suggestions can only be generated for a draft you can edit");
  const guide = await prisma.guide.findUniqueOrThrow({ where: { id: d.guideId } });
  const g = await gate(ctx, { templateKey: d.content.templateKey, classification: guide.classification });
  const step = opts.stepId ? flattenSteps(d.content.steps).find((s) => s.id === opts.stepId) : undefined;
  if (task === "rewrite_step" && !step) throw notFound("Step");
  let items: SuggestionInput[] = [];
  const promptId = PROMPT_FOR[task];
  let providerId = "local-rules";
  if (g.usedExternal && promptId) {
    const contentText = task === "rewrite_step" ? `${step!.title}\n${step!.text}` : JSON.stringify({ title: d.content.title, purpose: d.content.purpose, prerequisites: d.content.prerequisites, steps: flattenSteps(d.content.steps).map((s) => ({ id: s.id, kind: s.kind, title: s.title, text: s.text })) }); // never any image data
    const prompt = buildTaskPrompt(promptId, contentText, opts.language ? `Target language: ${opts.language}` : "");
    providerId = g.provider.id;
    if (task === "rewrite_step") { const r = await g.provider.complete({ system: SYSTEM_BASE, prompt, schema: rewriteSchema, promptId }); items = [{ kind: "rewrite", stepId: step!.id, payload: { title: r.title, text: r.text, before: { title: step!.title, text: step!.text } }, uncertainty: { reason: r.uncertainty || "AI rewrite; verify meaning is unchanged." } }]; }
    else if (task === "suggest_missing" || task === "terms") { const r = await g.provider.complete({ system: SYSTEM_BASE, prompt, schema: listSchema, promptId }); items = r.suggestions.filter((x) => ["prerequisite", "validation", "warning", "acronym", "term"].includes(x.kind)).map((x) => ({ kind: x.kind as SuggestionInput["kind"], payload: x.kind === "acronym" ? { term: x.text.split(/[:=\-–]/)[0].trim(), expansion: x.text.split(/[:=\-–]/).slice(1).join(":").trim() } : { text: x.text }, uncertainty: { reason: x.reason || "AI suggestion" } })); }
    else if (task === "summary" || task === "translate") { const r = await g.provider.complete({ system: SYSTEM_BASE, prompt, schema: textSchema, promptId }); items = [{ kind: task === "summary" ? "summary" : "translation", payload: { text: r.text, language: opts.language }, uncertainty: { reason: "AI generated; verify before use." } }]; }
    else { const r = await g.provider.complete({ system: SYSTEM_BASE, prompt, schema: itemsSchema, promptId }); items = task === "faq" ? r.items.map((i) => ({ kind: "faq" as const, payload: { text: `Q: ${i.question}\nA: ${i.answer ?? ""}` }, uncertainty: { reason: "AI generated; verify." } })) : r.items.filter((i) => i.options && i.correctIndex !== undefined).map((i) => ({ kind: "quiz" as const, payload: { question: i.question, options: i.options!, correctIndex: i.correctIndex! }, uncertainty: { reason: "AI generated; verify the correct answer." } })); }
  } else {
    if (task === "translate") throw unprocessable("Translation needs an external AI provider that your organisation's policy permits. None is available.");
    items = task === "suggest_missing" ? localSuggestMissing(d.content) : task === "terms" ? await localTerms(ctx.orgId, d.content) : task === "rewrite_step" ? localRewrite(step!) : task === "mismatch" ? await localMismatch(ctx, d.content) : task === "quiz" ? localQuiz(d.content) : task === "faq" ? localFaq(d.content) : localSummary(d.content);
  }
  if (task === "mismatch" && g.usedExternal) items = await localMismatch(ctx, d.content); // screenshots are only ever analysed locally
  const version = promptId ? PROMPT_VERSIONS[promptId] : 1;
  // do not re-suggest identical pending suggestions
  const pending = await prisma.aiSuggestion.findMany({ where: { versionId, status: "PENDING" } });
  const fresh = items.filter((i) => !pending.some((p) => p.kind === i.kind && p.stepId === (i.stepId ?? null) && JSON.stringify(p.payload) === JSON.stringify(i.payload)));
  const rows = await createSuggestions(ctx, versionId, fresh, providerId, `${promptId ?? `local-${task}`}#${version}`);
  await audit(ctx, null, { action: "AI_SUGGESTIONS_GENERATED", entityType: "GuideVersion", entityId: versionId, guideId: d.guideId, versionId, summary: `${rows.length} ${task} suggestion(s) generated by ${providerId}`, detail: { task, provider: providerId, external: g.usedExternal, policy: g.reason } });
  return { suggestions: rows, provider: providerId, policyNote: g.reason, note: fresh.length === 0 ? "Nothing to suggest." : undefined };
}
