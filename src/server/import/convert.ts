// Rules-based conversion of an extracted legacy document into the structured guide model.
// PRINCIPLES: never invent procedural facts (text is carried over verbatim or left empty and flagged); every step and section
// carries a confidence value and reason flags; imported content is untrusted until a person confirms it.
import { GuideContent, Step, StepFlag, emptyContent, guideContentSchema, newId, newStep } from "../../lib/guide-schema";
import type { ChangeSummaryBlock, ConversionFlag, ExtractedBlock, ExtractedDocument, Outcome } from "./types";

export interface ConvertOptions {
  now?: Date;
  obsoleteMonths?: number;
  retired?: { kind: string; value: string; replacement: string | null; note: string }[];
  sites?: { id: string; code: string; name: string }[];
  taxonomy?: { kind: string; code: string; label: string }[];
  templateKey?: string;
}

export interface MetadataSuggestions {
  title?: string; legacyDocumentId?: string; legacyVersion?: string; effectiveDate?: string; reviewDate?: string;
  owner?: string; author?: string; approvedBy?: string; siteId?: string | null; siteText?: string; department?: string;
  processCode?: string; functionCode?: string; systems: string[]; sapTransactions: string[];
}
export interface ImageAssociation { imageId: string; stepId: string | null; confidence: number; reason: string }
export interface ConversionResult {
  content: GuideContent;
  flags: ConversionFlag[];
  metadata: MetadataSuggestions;
  changeSummary: { blocks: ChangeSummaryBlock[]; counts: Record<Outcome, number> };
  imageAssociations: ImageAssociation[];
  unplacedBlockIds: string[];
  stepCount: number;
  overallConfidence: number;
}

type SectionKey = "purpose" | "scope" | "audience" | "responsibilities" | "definitions" | "prerequisites" | "permissions" | "equipment" | "ppe" | "hazards" | "training"
  | "procedure" | "expected" | "validation" | "troubleshooting" | "references" | "records" | "revision" | "approvals" | "toc";

const SECTION_MAP: [SectionKey, RegExp][] = [
  ["purpose", /^(purpose|objective|objectives|aim|intent|purpose and objective)s?$/],
  ["scope", /^(scope|applicability|applies to|scope and applicability|coverage)$/],
  ["audience", /^(audience|intended audience|who should use|target audience)$/],
  ["responsibilities", /^(responsibilit(y|ies)|roles( and responsibilities)?|accountabilit(y|ies)|roles)$/],
  ["definitions", /^(definitions?|abbreviations?|glossary|acronyms|terms|definitions and abbreviations|terms and definitions)$/],
  ["prerequisites", /^(prerequisites?|pre-?requisites?|before you begin|requirements|pre-?conditions?|before starting|inputs)$/],
  ["permissions", /^(permissions|access|required access|authori[sz]ations?|required permissions|system access|roles required)$/],
  ["equipment", /^(equipment|tools|materials|tools and equipment|equipment required)$/],
  ["ppe", /^(ppe|personal protective equipment)$/],
  ["hazards", /^(hazards?|risks?|safety|safety precautions|warnings|health and safety|risk assessment|precautions)$/],
  ["training", /^(training|competenc(y|ies)|required training)$/],
  ["procedure", /^(procedure|procedures|process|instructions|steps|method|work instructions?|how to|process steps|procedure steps|the procedure|detailed steps|activities)$/],
  ["expected", /^(expected results?|outcomes?|acceptance criteria|result|end result|expected outcome)$/],
  ["validation", /^(verification|validation|checks|quality checks|verification and validation|post-?checks?)$/],
  ["troubleshooting", /^(troubleshooting|problems?|faq|frequently asked questions|common problems|exceptions|error handling)$/],
  ["references", /^(references?|related (documents?|procedures?|policies)|see also|associated documents|related information)$/],
  ["records", /^(records?|forms|attachments|appendix|appendices|documentation)$/],
  ["revision", /^(revision history|change history|document history|amendment history|version history|changes|amendments|change log)$/],
  ["approvals", /^(approvals?|sign-?off|approval and authori[sz]ation|document approval|authori[sz]ation|signatures?)$/],
  ["toc", /^(contents|table of contents|toc)$/],
];

export function classifyHeading(text: string): SectionKey | null {
  const t = text.toLowerCase().replace(/^[\d.\s)]+/, "").replace(/[:\s]+$/, "").trim();
  for (const [k, re] of SECTION_MAP) if (re.test(t)) return k;
  return null;
}

const WARN = /^(warning|caution|danger|important|attention)\s*[:\-–!.]?\s+/i;
const NOTE = /^(note|tip|hint)\s*[:\-–]\s+/i;
const VAGUE = /\b(as (appropriate|required|necessary|needed)|if necessary|where applicable|etc\.?|tbd|to be confirmed|to be determined|and so on)\b|\?\?+/i;
const OBSOLETE_BUILTIN: [string, RegExp][] = [
  ["Windows XP/7", /\bwindows (xp|7|vista)\b/i], ["Internet Explorer", /\binternet explorer\b|\bIE ?11\b/i], ["Adobe Flash", /\bflash player\b|\badobe flash\b/i],
  ["Lotus Notes", /\blotus notes\b/i], ["Office 2010/2013", /\b(office|word|excel) ?(2003|2007|2010|2013)\b/i], ["Skype for Business", /\bskype for business\b/i],
];
const KNOWN_SYSTEMS = ["SAP", "Oracle", "Workday", "ServiceNow", "Salesforce", "SharePoint", "Outlook", "Teams", "Concur", "Coupa", "Ariba", "Maximo", "Kronos", "Dynamics 365", "Excel", "Power BI"];

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const stripNumber = (s: string) => norm(s.replace(/^(?:\(?\d+(?:\.\d+){0,3}[.)]|\(?[a-z][.)]|[•●▪◦\-–—*])\s+/, ""));

function parseDateLoose(s?: string): Date | null {
  if (!s) return null;
  const m1 = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(s.trim());
  if (m1) { const y = Number(m1[3]) < 100 ? 2000 + Number(m1[3]) : Number(m1[3]); const d = new Date(Date.UTC(y, Number(m1[2]) - 1, Number(m1[1]))); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(s.replace(/(\d)(st|nd|rd|th)/, "$1") + (/\d{4}$/.test(s.trim()) && !/UTC|GMT/.test(s) ? " UTC" : ""));
  return isNaN(d.getTime()) ? null : d;
}

function splitTitleText(text: string): { title: string; text: string } {
  const t = norm(text);
  const m = /^(.{8,110}?[.!?])\s+(.+)$/s.exec(t);
  if (m) return { title: m[1].replace(/[.]$/, ""), text: m[2] };
  return { title: t.length > 140 ? t.slice(0, 137) + "…" : t.replace(/[.]$/, ""), text: t.length > 140 ? t : "" };
}

export function convertToGuide(doc: ExtractedDocument, opts: ConvertOptions = {}): ConversionResult {
  const now = opts.now ?? new Date();
  const flags: ConversionFlag[] = [];
  const summary: ChangeSummaryBlock[] = [];
  const mark = (id: string, outcome: Outcome, reason: string, into?: string) => summary.push({ blockId: id, outcome, reason, into });
  const content = emptyContent(opts.templateKey ?? "general");
  const conf: Record<string, { confidence: number; note?: string }> = {};
  const unplaced: string[] = [];
  const blocks = doc.blocks;

  // ---- title ----
  const firstH = blocks.find((b) => b.type === "heading" && !classifyHeading(b.text) && (b.level ?? 1) <= 2);
  const metaTitle = doc.metadata.title && !/^(untitled|document\d*|microsoft word)/i.test(doc.metadata.title) ? doc.metadata.title : undefined;
  content.title = firstH ? norm(firstH.text) : metaTitle ?? "";
  conf.title = { confidence: firstH ? 0.9 : metaTitle ? 0.4 : 0, note: firstH ? "First heading of the document" : metaTitle ? "Taken from file properties/filename; confirm" : "No title found" };
  if (!content.title) flags.push({ code: "missing-title", message: "No title could be found.", severity: "warn" });
  if (firstH) mark(firstH.id, "retained", "Used as the guide title", "title");

  // ---- walk blocks into sections ----
  type Bucket = { key: SectionKey | "preamble" | "other"; heading?: ExtractedBlock; blocks: ExtractedBlock[] };
  const buckets: Bucket[] = [{ key: "preamble", blocks: [] }];
  let inProcedure = false;
  for (const b of blocks) {
    if (b === firstH) continue;
    if (b.type === "header_footer") { mark(b.id, "removed", "Header/footer text (document-control fields were captured as metadata suggestions)"); continue; }
    if (b.type === "heading") {
      const key = classifyHeading(b.text);
      if (key) { buckets.push({ key, heading: b, blocks: [] }); inProcedure = key === "procedure"; mark(b.id, "removed", `Section heading mapped to the template section "${key}"`); continue; }
      if (inProcedure) { buckets[buckets.length - 1].blocks.push(b); continue; } // sub-heading inside procedure = step group label
      buckets.push({ key: "other", heading: b, blocks: [] });
      continue;
    }
    buckets[buckets.length - 1].blocks.push(b);
  }
  const has = (k: SectionKey) => buckets.some((x) => x.key === k);

  const lines = (bl: ExtractedBlock[], sectionInto: string) => {
    const out: string[] = [];
    for (const b of bl) {
      if (b.type === "paragraph" || b.type === "list_item") { const t = b.type === "list_item" ? stripNumber(b.text) : norm(b.text); if (t) { out.push(t); mark(b.id, b.type === "list_item" && b.listNumber ? "retained" : "retained", "Carried over verbatim (list marker removed)", sectionInto); } }
      else if (b.type === "table") { for (const r of b.rows ?? []) { const t = norm(r.filter(Boolean).join(" – ")); if (t) out.push(t); } mark(b.id, "rewritten", "Table rows converted to list items", sectionInto); }
      else if (b.type === "image") { /* handled later */ }
    }
    return out;
  };
  const textOf = (k: SectionKey, into: string) => buckets.filter((x) => x.key === k).flatMap((x) => lines(x.blocks, into)).join("\n");
  const listOf = (k: SectionKey, into: string) => buckets.filter((x) => x.key === k).flatMap((x) => lines(x.blocks, into));

  // Preamble: paragraphs before any section heading (kept only as fallback purpose candidates)
  const pre = buckets[0].blocks.filter((b) => b.type === "paragraph" || b.type === "list_item");

  // ---- simple sections ----
  const setText = (field: "purpose" | "scope" | "audience" | "expectedResult", k: SectionKey, label: string) => {
    const v = textOf(k, field);
    if (v) { content[field] = v; conf[field] = { confidence: 0.92, note: `From the "${label}" section` }; }
    else conf[field] = { confidence: 0, note: `No "${label}" section found` };
  };
  setText("purpose", "purpose", "Purpose"); setText("scope", "scope", "Scope"); setText("audience", "audience", "Audience"); setText("expectedResult", "expected", "Expected result");
  if (!content.purpose) {
    const cand = pre.find((b) => b.type === "paragraph" && b.text.length > 30 && b.text.length < 500 && !/:\s/.test(b.text.slice(0, 25)));
    if (cand) { content.purpose = norm(cand.text); conf.purpose = { confidence: 0.35, note: "No Purpose heading: this is the first paragraph of the document and may not describe the purpose" }; mark(cand.id, "uncertain", "Used as purpose because it is the first paragraph; verify", "purpose"); flags.push({ code: "inferred-purpose", message: "No 'Purpose' section: the first paragraph was used verbatim. Verify it.", severity: "warn", blockIds: [cand.id] }); }
    else flags.push({ code: "missing-section", message: "No purpose found. It was not invented; please write one.", severity: "warn" });
  }
  if (!content.scope) flags.push({ code: "missing-section", message: "No scope found. It was not invented; please write one.", severity: "warn" });
  if (!content.expectedResult) flags.push({ code: "missing-section", message: "No expected result found. It was not invented; please add one.", severity: "info" });

  content.prerequisites = listOf("prerequisites", "prerequisites"); conf.prerequisites = { confidence: content.prerequisites.length ? 0.9 : 0 };
  content.permissions = listOf("permissions", "permissions");
  content.equipment = listOf("equipment", "equipment"); content.ppe = listOf("ppe", "ppe"); content.hazards = listOf("hazards", "hazards"); content.training = listOf("training", "training");
  content.validationChecks = listOf("validation", "validationChecks");
  if (!content.prerequisites.length) flags.push({ code: "missing-section", message: "No prerequisites section found.", severity: "info" });

  // definitions -> acronyms
  for (const bk of buckets.filter((x) => x.key === "definitions")) {
    const rowsFromTables = bk.blocks.filter((b) => b.type === "table").flatMap((b) => (b.rows ?? []).filter((r) => r.length >= 2 && r[0] && r[1] && !/^(term|abbreviation|acronym)$/i.test(r[0])).map((r) => ({ term: r[0], expansion: r.slice(1).join(" ") })));
    const fromLines = bk.blocks.filter((b) => b.type !== "table").map((b) => ({ b, t: stripNumber(b.text) })).map(({ b, t }) => { const m = /^([A-Za-z0-9/&.\- ]{1,40}?)\s*(?:[-–—:=])\s+(.+)$/.exec(t); if (m) mark(b.id, "retained", "Definition carried over", "acronyms"); else if (t) { mark(b.id, "uncertain", "Definition line without a clear term/definition split", "acronyms"); unplaced.push(b.id); } return m ? { term: m[1].trim(), expansion: m[2].trim() } : null; }).filter((x): x is { term: string; expansion: string } => !!x);
    for (const b of bk.blocks.filter((b) => b.type === "table")) mark(b.id, "rewritten", "Definition table rows converted to definitions", "acronyms");
    content.acronyms.push(...rowsFromTables, ...fromLines);
  }
  // responsibilities
  for (const bk of buckets.filter((x) => x.key === "responsibilities")) {
    for (const b of bk.blocks) {
      if (b.type === "table") { for (const r of b.rows ?? []) if (r.length >= 2 && r[0] && !/^(role|responsibility)$/i.test(r[0])) content.responsibilities.push({ role: r[0], responsibility: r.slice(1).join(" ") }); mark(b.id, "rewritten", "Table rows converted to responsibilities", "responsibilities"); }
      else if (b.type === "paragraph" || b.type === "list_item") {
        const t = stripNumber(b.text); const m = /^([A-Z][\w /&'-]{1,40}?)\s*(?:[-–—:])\s+(.+)$/.exec(t);
        content.responsibilities.push(m ? { role: m[1].trim(), responsibility: m[2].trim() } : { role: "", responsibility: t });
        mark(b.id, m ? "retained" : "uncertain", m ? "Role and responsibility carried over" : "Role could not be identified; responsibility kept without a role", "responsibilities");
        if (!m) flags.push({ code: "role-not-detected", message: `Responsibility without an identifiable role: "${t.slice(0, 60)}"`, severity: "info", blockIds: [b.id] });
      }
    }
  }
  // troubleshooting
  for (const bk of buckets.filter((x) => x.key === "troubleshooting")) {
    for (const b of bk.blocks) {
      if (b.type === "table") { for (const r of b.rows ?? []) if (r.length >= 2 && r[0] && !/^(problem|issue|symptom)$/i.test(r[0])) content.troubleshooting.push({ problem: r[0], resolution: r.slice(1).join(" ") }); mark(b.id, "rewritten", "Table rows converted to troubleshooting items", "troubleshooting"); }
      else if (b.type === "paragraph" || b.type === "list_item") {
        const t = stripNumber(b.text); const m = /^(?:problem|issue|if)[:\s-]+(.+?)(?:\s*(?:solution|fix|action|then)[:\s-]+(.+))$/i.exec(t);
        if (m) { content.troubleshooting.push({ problem: m[1], resolution: m[2] }); mark(b.id, "rewritten", "Problem/solution pair split", "troubleshooting"); }
        else { content.troubleshooting.push({ problem: t, resolution: "" }); mark(b.id, "uncertain", "No clear resolution found; kept as a problem statement", "troubleshooting"); flags.push({ code: "incomplete-troubleshooting", message: `No resolution found for: "${t.slice(0, 60)}"`, severity: "warn", blockIds: [b.id] }); }
      }
    }
  }
  // references/records -> related (title only: no document ids are invented)
  for (const k of ["references", "records"] as const) for (const t of listOf(k, "related")) content.related.push({ title: t });
  // removed sections
  for (const bk of buckets.filter((x) => ["revision", "approvals", "toc"].includes(x.key))) {
    for (const b of bk.blocks) mark(b.id, "removed", bk.key === "revision" ? "Revision history stays with the original source; write a new change summary" : bk.key === "approvals" ? "Legacy approvals/signatures are not carried over; the new document needs new approval" : "Table of contents is regenerated");
    if (bk.key === "approvals") flags.push({ code: "legacy-approvals-dropped", message: "The source contained approval/signature information. It was not carried over: the new guide requires a fresh approval.", severity: "info" });
  }
  // other unknown headings: content goes to "unplaced" (uncertain)
  for (const bk of buckets.filter((x) => x.key === "other")) {
    flags.push({ code: "unrecognised-section", message: `Section "${bk.heading?.text}" does not match a template section; its content was not placed.`, severity: "warn", blockIds: bk.heading ? [bk.heading.id] : [] });
    if (bk.heading) { mark(bk.heading.id, "uncertain", "Unrecognised section heading"); unplaced.push(bk.heading.id); }
    for (const b of bk.blocks) if (b.type !== "image") { mark(b.id, "uncertain", `In unrecognised section "${bk.heading?.text}"; not placed`); unplaced.push(b.id); }
  }

  // ---- procedure ----
  let procBlocks: ExtractedBlock[] = buckets.filter((x) => x.key === "procedure").flatMap((x) => x.blocks);
  let procConfidence = 0.9;
  let procNote = "From the procedure section";
  if (!procBlocks.length) {
    const pool = [...buckets[0].blocks, ...buckets.filter((x) => x.key === "other").flatMap((x) => x.blocks)];
    const ordered = pool.filter((b) => b.type === "list_item" && b.ordered);
    const anyList = pool.filter((b) => b.type === "list_item");
    if (ordered.length >= 2) { procBlocks = pool.filter((b) => b.type === "list_item" || b.type === "image"); procConfidence = 0.6; procNote = "No procedure heading: numbered list items used as steps"; }
    else if (anyList.length >= 2) { procBlocks = pool.filter((b) => b.type === "list_item" || b.type === "image"); procConfidence = 0.45; procNote = "No procedure heading: bullet items used as steps"; }
    else { procBlocks = pool.filter((b) => b.type === "paragraph").slice(1); procConfidence = 0.3; procNote = "No procedure or list found: paragraphs used as steps"; }
    if (procBlocks.length) flags.push({ code: "no-procedure-heading", message: procNote + ". Verify the order and completeness of the steps.", severity: "warn" });
    for (const b of procBlocks) { const i = unplaced.indexOf(b.id); if (i >= 0) unplaced.splice(i, 1); const s = summary.findIndex((x) => x.blockId === b.id); if (s >= 0) summary.splice(s, 1); }
  }
  const hasLists = procBlocks.some((b) => b.type === "list_item");
  const steps: Step[] = [];
  const blockStep = new Map<string, string>();
  const controlLike = (b: ExtractedBlock) => b.type === "table" && (b.rows?.[0] ?? []).join(" ").match(/\b(document|rev|version|owner|effective)\b/i) && !/step|action/i.test((b.rows?.[0] ?? []).join(" "));
  let lastStep: Step | null = null;
  const flagsFor = (text: string): StepFlag[] => {
    const f: StepFlag[] = [];
    if (VAGUE.test(text)) f.push({ code: "vague-language", message: "Contains vague wording (e.g. 'as appropriate', 'etc.'). Make it specific.", severity: "warn" });
    if (/\b(if|when|in case)\b[^.]{3,120}\b(then|,)\s/i.test(text)) f.push({ code: "possible-decision", message: "Conditional wording: consider modelling this as a decision point with paths.", severity: "info" });
    return f;
  };
  for (const b of procBlocks) {
    if (b.type === "heading") { const s = newStep("note", { title: norm(b.text), text: "", origin: { type: "import", sourceBlockIds: [b.id], confidence: 0.7, flags: [{ code: "group-heading", message: "Sub-heading in the source, kept as a note.", severity: "info" }] } }); steps.push(s); blockStep.set(b.id, s.id); mark(b.id, "rewritten", "Sub-heading kept as a note step", s.id); lastStep = s; continue; }
    if (b.type === "image") continue; // associated after steps exist
    if (b.type === "table") {
      if (controlLike(b)) { mark(b.id, "removed", "Document-control/revision table (captured as metadata suggestions)"); continue; }
      const head = (b.rows?.[0] ?? []).map((c) => c.toLowerCase());
      const actCol = head.findIndex((c) => /action|description|instruction|task|activity|detail/.test(c));
      if (head.some((c) => /^(step|no\.?|#)$/.test(c)) || actCol >= 0) {
        const col = actCol >= 0 ? actCol : head.findIndex((c, i) => i > 0 && c);
        for (const r of (b.rows ?? []).slice(1)) {
          const text = norm(r[col] ?? ""); if (!text) continue;
          const extra = r.map((c, i) => (i !== col && i !== 0 && c ? `${(b.rows![0][i] || "").trim() ? b.rows![0][i] + ": " : ""}${c}` : "")).filter(Boolean).join(" · ");
          const { title, text: rest } = splitTitleText(text);
          const s = newStep("action", { title, text: [rest, extra].filter(Boolean).join("\n"), origin: { type: "import", sourceBlockIds: [b.id], confidence: 0.75, flags: flagsFor(text) } });
          steps.push(s); lastStep = s;
        }
        blockStep.set(b.id, steps[steps.length - 1]?.id ?? "");
        mark(b.id, "rewritten", "Table rows converted to steps", "steps");
      } else { mark(b.id, "uncertain", "Table in the procedure section could not be interpreted as steps"); unplaced.push(b.id); flags.push({ code: "unplaced-table", message: "A table in the procedure could not be converted; review it in the source.", severity: "warn", blockIds: [b.id] }); }
      continue;
    }
    // paragraph / list item
    const rawText = b.type === "list_item" ? stripNumber(b.text) : norm(b.text);
    if (!rawText) continue;
    if (b.type === "list_item" && (b.level ?? 0) > 0 && lastStep && lastStep.kind === "action") {
      lastStep.text = [lastStep.text, `- ${rawText}`].filter(Boolean).join("\n");
      lastStep.origin.sourceBlockIds = [...(lastStep.origin.sourceBlockIds ?? []), b.id];
      blockStep.set(b.id, lastStep.id); mark(b.id, "rewritten", "Nested item appended to its parent step", lastStep.id); continue;
    }
    const w = WARN.exec(rawText), n = NOTE.exec(rawText);
    if (w || n) {
      const kind = w ? "warning" : /^tip|hint/i.test(rawText) ? "tip" : "note";
      const s = newStep(kind, { title: "", text: rawText.replace(w ? WARN : NOTE, ""), origin: { type: "import", sourceBlockIds: [b.id], confidence: 0.85, flags: [] } });
      steps.push(s); blockStep.set(b.id, s.id); mark(b.id, "rewritten", `Recognised as a ${kind} and converted to a ${kind} step`, s.id); continue;
    }
    let base = b.type === "list_item" ? (b.ordered ? procConfidence : Math.min(procConfidence, 0.7)) : hasLists ? 0.5 : Math.min(procConfidence, 0.5);
    if (b.ocr) base -= 0.2;
    const f = flagsFor(rawText);
    if (f.some((x) => x.code === "vague-language")) base -= 0.1;
    if (b.type === "paragraph" && hasLists) f.push({ code: "unnumbered-paragraph", message: "This paragraph sat between numbered steps in the source; it was kept as a note.", severity: "info" });
    if (b.ocr) f.push({ code: "ocr", message: "Recognised by OCR; check for misread characters.", severity: "warn" });
    const kind = b.type === "paragraph" && hasLists ? "note" : "action";
    const { title, text } = kind === "action" ? splitTitleText(rawText) : { title: "", text: rawText };
    const s = newStep(kind, { title, text, origin: { type: "import", sourceBlockIds: [b.id], confidence: Math.max(0.1, base), flags: f } });
    (s as Step & { _num?: string })._num = b.type === "list_item" && b.ordered && (b.level ?? 0) === 0 ? b.listNumber : undefined;
    steps.push(s); lastStep = s; blockStep.set(b.id, s.id);
    mark(b.id, title && text ? "rewritten" : "retained", title && text ? "Sentence split into a step title and detail (wording unchanged)" : "Carried over verbatim (numbering regenerated)", s.id);
  }
  content.steps = steps;
  conf.steps = { confidence: steps.length ? steps.reduce((a, s) => a + (s.origin.confidence ?? 0.5), 0) / steps.length : 0, note: procNote };
  if (!steps.length) flags.push({ code: "no-steps", message: "No procedure steps could be identified.", severity: "error" });

  // numbering consistency + duplicates + cross references
  const nums = steps.map((s) => (s as Step & { _num?: string })._num).map((n, i) => ({ n, i })).filter((x) => x.n && /^\d+$/.test(x.n!));
  for (let k = 1; k < nums.length; k++) {
    const prev = Number(nums[k - 1].n), cur = Number(nums[k].n);
    if (cur !== prev + 1) { const s = steps[nums[k].i]; s.origin.flags.push({ code: "numbering-inconsistent", message: `Source numbering goes from ${prev} to ${cur}.`, severity: "warn" }); flags.push({ code: "numbering-inconsistent", message: `Source step numbering goes from ${prev} to ${cur} (possible missing or duplicated step).`, severity: "warn", stepId: s.id }); }
  }
  for (const s of steps) delete (s as Step & { _num?: string })._num;
  const seen = new Map<string, Step>();
  for (const s of steps.filter((x) => x.kind === "action")) {
    const key = norm(`${s.title} ${s.text}`).toLowerCase();
    if (seen.has(key)) { s.origin.flags.push({ code: "duplicate-step", message: "Identical to an earlier step.", severity: "warn" }); flags.push({ code: "duplicate-step", message: `Duplicate step: "${s.title.slice(0, 50)}"`, severity: "warn", stepId: s.id }); } else seen.set(key, s);
  }
  const actionCount = steps.filter((s) => s.kind === "action").length;
  for (const s of steps) {
    const m = /\bstep\s+(\d+)\b/i.exec(`${s.title} ${s.text}`);
    if (m && Number(m[1]) > actionCount) { s.origin.flags.push({ code: "broken-cross-reference", message: `Refers to step ${m[1]} but the procedure has ${actionCount} steps.`, severity: "warn" }); flags.push({ code: "broken-cross-reference", message: `Reference to step ${m[1]} but only ${actionCount} steps exist.`, severity: "warn", stepId: s.id }); }
    if (/\bappendix\s+[a-z0-9]\b/i.test(`${s.title} ${s.text}`) && !buckets.some((x) => x.key === "records")) { s.origin.flags.push({ code: "missing-appendix", message: "Refers to an appendix that was not found in the document.", severity: "warn" }); flags.push({ code: "missing-appendix", message: "Refers to an appendix that is not in the document.", severity: "warn", stepId: s.id }); }
  }

  // ---- obsolete-looking content ----
  const allText = [content.purpose, content.scope, ...content.prerequisites, ...steps.map((s) => `${s.title} ${s.text}`)].join("\n");
  const retiredHits: string[] = [];
  for (const r of opts.retired ?? []) if (new RegExp(`(^|[^a-z0-9])${r.value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(allText.toLowerCase())) { retiredHits.push(r.value); flags.push({ code: "obsolete-reference", message: `References ${r.kind.toLowerCase()} "${r.value}", registered as retired${r.replacement ? ` (replacement: ${r.replacement})` : ""}.`, severity: "warn" }); for (const s of steps) if (new RegExp(`(^|[^a-z0-9])${r.value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(`${s.title} ${s.text}`.toLowerCase())) s.origin.flags.push({ code: "obsolete-reference", message: `Mentions retired ${r.value}.`, severity: "warn" }); }
  for (const [name, re] of OBSOLETE_BUILTIN) if (re.test(allText)) { retiredHits.push(name); flags.push({ code: "obsolete-reference", message: `Mentions ${name}, which is out of support.`, severity: "warn" }); for (const s of steps) if (re.test(`${s.title} ${s.text}`)) s.origin.flags.push({ code: "obsolete-reference", message: `Mentions ${name}.`, severity: "warn" }); }
  const eff = parseDateLoose(doc.docControl.effectiveDate) ?? parseDateLoose(doc.metadata.modified) ?? parseDateLoose(doc.metadata.created);
  const ageMonths = eff ? (now.getTime() - eff.getTime()) / (30.4 * 86400_000) : null;
  const obsoleteAge = ageMonths !== null && ageMonths > (opts.obsoleteMonths ?? 24);
  if (obsoleteAge) flags.push({ code: "obsolete-looking-age", message: `The document is dated ${eff!.toISOString().slice(0, 10)} (${Math.round(ageMonths!)} months ago). Its content and screenshots may be out of date.`, severity: "warn" });
  const rd = parseDateLoose(doc.docControl.reviewDate);
  if (rd && rd < now) flags.push({ code: "overdue-in-source", message: `The source's own review date (${rd.toISOString().slice(0, 10)}) has passed.`, severity: "warn" });
  if (eff && rd && rd < eff) flags.push({ code: "contradictory-dates", message: "The review date is earlier than the effective date.", severity: "warn" });
  for (const [k, v] of Object.entries(doc.docControl)) if (k.endsWith("__conflict")) flags.push({ code: "conflicting-control-data", message: `Conflicting ${k.replace("__conflict", "")} values in the source: ${v}`, severity: "warn" });
  if (!doc.docControl.owner) flags.push({ code: "missing-owner", message: "No process owner named in the source; ownership must be assigned.", severity: "info" });

  // ---- images -> steps ----
  const associations: ImageAssociation[] = [];
  const stepBlockIndex = new Map<string, number>();
  procBlocks.forEach((b, i) => stepBlockIndex.set(b.id, i));
  for (const im of doc.images) {
    const ib = blocks.find((b) => b.imageId === im.id)!;
    const idxInProc = procBlocks.indexOf(ib);
    let stepId: string | null = null, confidence = 0, reason = "Image is outside the procedure";
    if (idxInProc >= 0) {
      for (let j = idxInProc - 1; j >= 0; j--) { const sid = blockStep.get(procBlocks[j].id); if (sid) { stepId = sid; confidence = 0.7; reason = "Follows this step in the document"; break; } }
      if (!stepId) for (let j = idxInProc + 1; j < procBlocks.length; j++) { const sid = blockStep.get(procBlocks[j].id); if (sid) { stepId = sid; confidence = 0.45; reason = "Precedes this step in the document (no earlier step)"; break; } }
    } else if (im.page) {
      const onPage = procBlocks.filter((b) => b.page === im.page && blockStep.has(b.id));
      if (onPage.length) { stepId = blockStep.get(onPage[onPage.length - 1].id)!; confidence = 0.4; reason = `Same page (${im.page}) as this step`; }
    }
    associations.push({ imageId: im.id, stepId, confidence, reason });
    const step = stepId ? steps.find((s) => s.id === stepId) : undefined;
    const lowRes = (im.width ?? 0) > 0 && (im.width ?? 0) < 500;
    if (step && !step.image) {
      const needs = obsoleteAge || retiredHits.length > 0 || lowRes;
      step.image = { assetId: `pending:${im.id}`, alt: im.alt ?? "", annotations: [], ...(needs ? { needsReplacement: true, replaceReason: obsoleteAge ? "Imported from an old document; the screen may have changed" : retiredHits.length ? "Document references retired systems" : "Low-resolution imported image" } : {}) };
      if (needs) step.origin.flags.push({ code: "replace-screenshot", message: step.image.replaceReason!, severity: "warn" });
      mark(ib.id, "retained", "Image kept as the screenshot of this step", step.id);
      if (confidence < 0.5) step.origin.flags.push({ code: "image-association-uncertain", message: `Image matched to this step with low confidence (${reason}).`, severity: "info" });
    } else {
      mark(ib.id, "uncertain", step ? "Step already has an image" : "Image could not be matched to a step"); unplaced.push(ib.id);
      flags.push({ code: "unassigned-image", message: "An image could not be matched to a step. Place it manually or discard it.", severity: "warn", blockIds: [ib.id] });
    }
  }

  // ---- unassigned blocks left in preamble ----
  for (const b of buckets[0].blocks) {
    if (summary.some((x) => x.blockId === b.id) || b.type === "image") continue;
    if (b.type === "table") { mark(b.id, controlLike(b) || /\b(document|rev|version|owner|effective)\b/i.test(b.text) ? "removed" : "uncertain", controlLike(b) ? "Document-control table (captured as metadata suggestions)" : "Table before the first section; not placed"); if (!summary.find((x) => x.blockId === b.id && x.outcome === "removed")) unplaced.push(b.id); continue; }
    if (/^(page \d+( of \d+)?|\d+)$/i.test(b.text)) { mark(b.id, "removed", "Page number"); continue; }
    if (b.type === "paragraph" && b.text.length < 120 && /(document|rev|version|owner|effective|date|author|approved)\s*[:\-]/i.test(b.text)) { mark(b.id, "removed", "Document-control line (captured as metadata suggestions)"); continue; }
    mark(b.id, "uncertain", "Text before the first section heading; not placed"); unplaced.push(b.id);
  }
  for (const b of blocks) if (!summary.some((x) => x.blockId === b.id)) { mark(b.id, "uncertain", "Not classified"); if (b.type !== "image") unplaced.push(b.id); }
  if (unplaced.length) flags.push({ code: "unplaced-content", message: `${unplaced.length} block(s) of source content were not placed anywhere. See the comparison view.`, severity: "warn", blockIds: unplaced.slice(0, 50) });

  // ---- metadata suggestions ----
  const dc = doc.docControl;
  const systems = KNOWN_SYSTEMS.filter((s) => new RegExp(`\\b${s}\\b`).test(allText));
  const tcodeContext = /\bSAP\b|transaction|t-?code/i.test(allText);
  const tcodes = tcodeContext ? [...new Set([...allText.matchAll(/\b((?:[A-Z]{2}\d{2}[A-Z]?N?|MIGO|MIRO|MMBE|SE\d{2}|F-\d{2}|FB\d{2}|VA\d{2}N?|ME\d{2}N?|XK\d{2}|MK\d{2}))\b/g)].map((m) => m[1]))].slice(0, 20) : [];
  const site = dc.site ? (opts.sites ?? []).find((s) => s.name.toLowerCase().includes(dc.site.toLowerCase()) || dc.site.toLowerCase().includes(s.name.toLowerCase()) || s.code.toLowerCase() === dc.site.toLowerCase()) : undefined;
  const tx = (kind: string, needle?: string) => needle ? (opts.taxonomy ?? []).find((t) => t.kind === kind && (t.label.toLowerCase() === needle.toLowerCase() || t.code.toLowerCase() === needle.toLowerCase())) : undefined;
  const metadata: MetadataSuggestions = {
    title: content.title || undefined, legacyDocumentId: dc.documentId, legacyVersion: dc.version, effectiveDate: dc.effectiveDate, reviewDate: dc.reviewDate, owner: dc.owner, author: dc.author, approvedBy: dc.approvedBy,
    siteId: site?.id ?? null, siteText: dc.site, department: dc.department, processCode: tx("PROCESS", dc.department)?.code, functionCode: tx("FUNCTION", dc.department)?.code, systems, sapTransactions: tcodes,
  };
  if (dc.site && !site) flags.push({ code: "site-unmapped", message: `Site "${dc.site}" in the source does not match a configured site.`, severity: "info" });

  const parsed = guideContentSchema.parse({ ...content, sectionConfidence: conf, importFlags: flags.map((f) => ({ code: f.code, message: f.message, severity: f.severity })).slice(0, 200) });
  const counts: Record<Outcome, number> = { retained: 0, rewritten: 0, removed: 0, uncertain: 0 };
  for (const s of summary) counts[s.outcome]++;
  const confs = [conf.steps?.confidence ?? 0, conf.purpose?.confidence ?? 0, conf.scope?.confidence ?? 0].filter((x) => x !== undefined);
  return { content: parsed, flags, metadata, changeSummary: { blocks: summary, counts }, imageAssociations: associations, unplacedBlockIds: [...new Set(unplaced)], stepCount: steps.length, overallConfidence: confs.reduce((a, b) => a + b, 0) / (confs.length || 1) };
}
void newId;
