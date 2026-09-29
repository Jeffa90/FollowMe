// Configurable guide templates (stored per organisation; these are the seeded defaults).
import type { GuideContent, StepKind } from "./guide-schema";

export type SectionKey =
  | "purpose" | "scope" | "audience" | "responsibilities" | "prerequisites" | "permissions" | "equipment" | "ppe" | "hazards"
  | "training" | "qualityRequirements" | "regulatory" | "policies" | "steps" | "expectedResult" | "validationChecks"
  | "troubleshooting" | "related" | "attachments" | "acronyms" | "competency";

export interface TemplateSection {
  key: SectionKey;
  label: string;
  required: boolean;
  enabled: boolean;
  hint?: string;
}
export type MetaKey = "systems" | "applications" | "websites" | "sapTransactions" | "businessRoles" | "processCode" | "siteId";
export interface TemplateDef {
  sections: TemplateSection[];
  requiredMeta: MetaKey[];
  stepKinds: StepKind[];
  defaults: Partial<GuideContent>;
}

const S = (key: SectionKey, label: string, required = false, enabled = true, hint?: string): TemplateSection => ({ key, label, required, enabled, hint });

const base: TemplateSection[] = [
  S("purpose", "Purpose", true, true, "Why this procedure exists, in one or two sentences."),
  S("scope", "Scope", true, true, "What is covered, and what is not."),
  S("audience", "Audience", false),
  S("responsibilities", "Responsibilities", false),
  S("prerequisites", "Prerequisites", false),
  S("permissions", "Required permissions", false),
  S("equipment", "Equipment", false, false),
  S("ppe", "PPE", false, false),
  S("hazards", "Hazards", false, false),
  S("training", "Required training", false, false),
  S("qualityRequirements", "Quality requirements", false, false),
  S("regulatory", "Regulatory requirements", false, false),
  S("policies", "Policy requirements", false, false),
  S("steps", "Procedure", true),
  S("expectedResult", "Expected result", true),
  S("validationChecks", "Validation checks", false),
  S("troubleshooting", "Troubleshooting", false),
  S("related", "Related procedures", false),
  S("attachments", "Attachments", false),
  S("acronyms", "Definitions and acronyms", false),
  S("competency", "Competency and acknowledgement", false),
];
const on = (keys: SectionKey[], required?: SectionKey[]) =>
  base.map((s) => ({ ...s, enabled: s.enabled || keys.includes(s.key), required: s.required || (required ?? []).includes(s.key) }));

export const DEFAULT_TEMPLATES: { key: string; name: string; description: string; definition: TemplateDef }[] = [
  {
    key: "general",
    name: "Controlled procedure",
    description: "General controlled procedure with purpose, scope, steps and expected result.",
    definition: {
      sections: on(["hazards", "training"]),
      requiredMeta: [],
      stepKinds: ["action", "note", "tip", "warning", "control", "expected", "physical", "decision", "exception", "block"],
      defaults: {},
    },
  },
  {
    key: "sap",
    name: "SAP instruction",
    description: "System instruction for SAP with transaction codes, permissions and validation checks.",
    definition: {
      sections: on(["permissions", "acronyms", "troubleshooting", "related"], ["prerequisites", "permissions", "validationChecks"]),
      requiredMeta: ["sapTransactions", "systems"],
      stepKinds: ["action", "note", "tip", "warning", "control", "expected", "decision", "exception", "block"],
      defaults: { prerequisites: ["SAP access with the role listed under Required permissions"] },
    },
  },
  {
    key: "admin",
    name: "Administrative process",
    description: "Business or administrative process with responsibilities and approvals.",
    definition: {
      sections: on(["responsibilities", "policies", "related"], ["responsibilities"]),
      requiredMeta: [],
      stepKinds: ["action", "note", "tip", "warning", "control", "expected", "physical", "decision", "exception", "block"],
      defaults: {},
    },
  },
  {
    key: "safety",
    name: "Safety instruction",
    description: "Safety-critical procedure: hazards, PPE, training and acknowledgement are mandatory.",
    definition: {
      sections: on(["equipment", "ppe", "hazards", "training", "regulatory", "competency", "responsibilities"], ["ppe", "hazards", "training", "competency"]),
      requiredMeta: ["siteId"],
      stepKinds: ["action", "note", "warning", "control", "expected", "physical", "decision", "exception", "block"],
      defaults: { competency: { acknowledgementRequired: true, quizRequired: false, checklistRequired: true, quiz: [], checklist: [] } },
    },
  },
];
