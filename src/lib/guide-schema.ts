// Authoritative structured guide model. Shared by server (validation) and client (editor).
// Everything a guide says lives here; exports (DOCX/PDF/HTML/MD) are generated from it.
import { z } from "zod";

export const STEP_KINDS = [
  "action",
  "note",
  "tip",
  "warning",
  "control",
  "expected",
  "physical",
  "decision",
  "exception",
  "block",
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const STEP_KIND_LABELS: Record<StepKind, string> = {
  action: "Action",
  note: "Note",
  tip: "Tip",
  warning: "Warning",
  control: "Control",
  expected: "Expected result",
  physical: "Physical / offline step",
  decision: "Decision point",
  exception: "Exception path",
  block: "Reusable block",
};

export const ANNOTATION_KINDS = ["box", "arrow", "highlight", "blur", "marker"] as const;

const norm = z.number().min(0).max(1);

export const annotationSchema = z.object({
  id: z.string().max(40),
  kind: z.enum(ANNOTATION_KINDS),
  x: norm,
  y: norm,
  w: norm.optional(),
  h: norm.optional(),
  x2: norm.optional(),
  y2: norm.optional(),
  n: z.number().int().min(1).max(99).optional(),
  label: z.string().max(120).optional(),
});
export type Annotation = z.infer<typeof annotationSchema>;

export const stepFlagSchema = z.object({
  code: z.string().max(60),
  message: z.string().max(400),
  severity: z.enum(["info", "warn", "error"]).default("warn"),
});
export type StepFlag = z.infer<typeof stepFlagSchema>;

export const stepImageSchema = z.object({
  assetId: z.string().max(60),
  alt: z.string().max(500).default(""),
  annotations: z.array(annotationSchema).max(60).default([]),
  sourceAssetId: z.string().max(60).optional(),
  needsReplacement: z.boolean().optional(),
  replaceReason: z.string().max(300).optional(),
});
export type StepImage = z.infer<typeof stepImageSchema>;

export const originSchema = z.object({
  type: z.enum(["manual", "capture", "import", "ai"]).default("manual"),
  eventId: z.string().max(60).optional(),
  sourceBlockIds: z.array(z.string().max(60)).max(50).optional(),
  confidence: z.number().min(0).max(1).optional(),
  flags: z.array(stepFlagSchema).max(20).default([]),
});
export type StepOrigin = z.infer<typeof originSchema>;

export const linkSchema = z.object({
  label: z.string().max(200),
  url: z.string().max(2000),
});

export interface Step {
  id: string;
  kind: StepKind;
  title: string;
  text: string;
  image?: StepImage;
  links: { label: string; url: string }[];
  origin: StepOrigin;
  decision?: { question: string; branches: { id: string; label: string; steps: Step[] }[] };
  exception?: { condition: string };
  physical?: { location?: string; equipment?: string };
  blockRef?: { blockId: string; version: number; kind: string; title: string; body: string };
}

export const stepSchema: z.ZodType<Step> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(40),
    kind: z.enum(STEP_KINDS),
    title: z.string().max(300).default(""),
    text: z.string().max(6000).default(""),
    image: stepImageSchema.optional(),
    links: z.array(linkSchema).max(20).default([]),
    origin: originSchema.default({ type: "manual", flags: [] }),
    decision: z
      .object({
        question: z.string().max(500),
        branches: z
          .array(
            z.object({
              id: z.string().max(40),
              label: z.string().max(200),
              steps: z.array(stepSchema).max(60),
            }),
          )
          .max(8),
      })
      .optional(),
    exception: z.object({ condition: z.string().max(500) }).optional(),
    physical: z
      .object({ location: z.string().max(200).optional(), equipment: z.string().max(200).optional() })
      .optional(),
    blockRef: z
      .object({
        blockId: z.string().max(60),
        version: z.number().int(),
        kind: z.string().max(40),
        title: z.string().max(300),
        body: z.string().max(6000),
      })
      .optional(),
  }),
) as z.ZodType<Step>;

const list = (max = 60, len = 500) => z.array(z.string().max(len)).max(max).default([]);

export const guideContentSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  templateKey: z.string().max(60).default("general"),
  title: z.string().max(300).default(""),
  purpose: z.string().max(4000).default(""),
  scope: z.string().max(4000).default(""),
  audience: z.string().max(1000).default(""),
  responsibilities: z
    .array(z.object({ role: z.string().max(200), responsibility: z.string().max(1000) }))
    .max(40)
    .default([]),
  prerequisites: list(),
  permissions: list(),
  equipment: list(),
  ppe: list(),
  hazards: list(),
  training: list(),
  qualityRequirements: list(),
  regulatory: list(),
  policies: list(),
  expectedResult: z.string().max(4000).default(""),
  validationChecks: list(),
  troubleshooting: z
    .array(z.object({ problem: z.string().max(500), resolution: z.string().max(2000) }))
    .max(60)
    .default([]),
  related: z
    .array(z.object({ documentId: z.string().max(60).optional(), title: z.string().max(300), url: z.string().max(2000).optional() }))
    .max(40)
    .default([]),
  attachments: z.array(z.object({ assetId: z.string().max(60), name: z.string().max(300) })).max(30).default([]),
  acronyms: z.array(z.object({ term: z.string().max(40), expansion: z.string().max(300) })).max(100).default([]),
  competency: z
    .object({
      acknowledgementRequired: z.boolean().default(false),
      quizRequired: z.boolean().default(false),
      checklistRequired: z.boolean().default(false),
      reassessmentMonths: z.number().int().min(1).max(120).optional(),
      quiz: z
        .array(
          z.object({
            question: z.string().max(500),
            options: z.array(z.string().max(300)).min(2).max(6),
            correctIndex: z.number().int().min(0).max(5),
          }),
        )
        .max(30)
        .default([]),
      checklist: z.array(z.string().max(400)).max(40).default([]),
    })
    .default({ acknowledgementRequired: false, quizRequired: false, checklistRequired: false, quiz: [], checklist: [] }),
  steps: z.array(stepSchema).max(400).default([]),
  // Import provenance: per-section confidence and uncertainty (human must confirm)
  sectionConfidence: z
    .record(z.string(), z.object({ confidence: z.number().min(0).max(1), note: z.string().max(400).optional() }))
    .optional(),
  importFlags: z.array(stepFlagSchema).max(200).optional(),
});
export type GuideContent = z.infer<typeof guideContentSchema>;

export function newId(prefix = "s"): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function newStep(kind: StepKind = "action", partial: Partial<Step> = {}): Step {
  return {
    id: newId("s"),
    kind,
    title: "",
    text: "",
    links: [],
    origin: { type: "manual", flags: [] },
    ...partial,
    ...(kind === "decision" && !partial.decision
      ? {
          decision: {
            question: "",
            branches: [
              { id: newId("b"), label: "Yes", steps: [] },
              { id: newId("b"), label: "No", steps: [] },
            ],
          },
        }
      : {}),
    ...(kind === "exception" && !partial.exception ? { exception: { condition: "" } } : {}),
  };
}

export function emptyContent(templateKey = "general", title = ""): GuideContent {
  return guideContentSchema.parse({ templateKey, title });
}

/** Numbering: top level "1", "2"; decision branch steps "3.A.1". Notes/warnings attach without consuming numbers. */
export interface NumberedStep {
  step: Step;
  number: string; // "" for un-numbered kinds
  depth: number;
  path: string; // stable anchor e.g. step id
}
const UNNUMBERED: StepKind[] = ["note", "tip", "warning", "control", "expected", "block"];

export function numberSteps(steps: Step[], prefix = "", depth = 0): NumberedStep[] {
  const out: NumberedStep[] = [];
  let n = 0;
  for (const step of steps) {
    let number = "";
    if (!UNNUMBERED.includes(step.kind)) {
      n += 1;
      number = `${prefix}${n}`;
    }
    out.push({ step, number, depth, path: step.id });
    if (step.decision) {
      step.decision.branches.forEach((b, i) => {
        const letter = String.fromCharCode(65 + i);
        out.push(...numberSteps(b.steps, `${number || prefix}.${letter}.`, depth + 1));
      });
    }
  }
  return out;
}

export function flattenSteps(steps: Step[]): Step[] {
  const out: Step[] = [];
  for (const s of steps) {
    out.push(s);
    if (s.decision) for (const b of s.decision.branches) out.push(...flattenSteps(b.steps));
  }
  return out;
}

export function findStep(steps: Step[], id: string): Step | undefined {
  return flattenSteps(steps).find((s) => s.id === id);
}

/** Plain-text summary of a step for search, AI retrieval and comparison. */
export function stepPlainText(step: Step): string {
  const parts = [step.title, step.text];
  if (step.decision) {
    parts.push(step.decision.question);
    for (const b of step.decision.branches) parts.push(b.label);
  }
  if (step.exception) parts.push(step.exception.condition);
  if (step.blockRef) parts.push(step.blockRef.title, step.blockRef.body);
  if (step.image?.alt) parts.push(step.image.alt);
  return parts.filter(Boolean).join(". ").replace(/\*\*|`/g, "");
}

/** Allowed URL schemes for links inside content (blocks javascript:, data:, etc.). */
export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url, "https://placeholder.invalid");
    return ["http:", "https:", "mailto:"].includes(u.protocol) || url.startsWith("/");
  } catch {
    return false;
  }
}

/** Minimal inline markup: **bold**, `code`. Anything else is literal text (rendered escaped by React). */
export type Inline = { t: "text" | "bold" | "code"; v: string };
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) out.push({ t: "bold", v: tok.slice(2, -2) });
    else out.push({ t: "code", v: tok.slice(1, -1) });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

export function stripInline(text: string): string {
  return parseInline(text)
    .map((i) => i.v)
    .join("");
}
