import { z } from "zod";
import { CLASSIFICATIONS } from "./roles";

export const aiPolicySchema = z.object({
  /** Organisation-wide AI kill switch (also disables the local provider's assistant features). */
  enabled: z.boolean().default(true),
  /** External (network) AI providers may only be used when true. */
  externalAllowed: z.boolean().default(false),
  /** Highest classification that may be sent to an external provider. */
  externalMaxClassification: z.enum(CLASSIFICATIONS).default("INTERNAL"),
  /** Screenshots are never sent externally unless this is true AND externalAllowed. */
  sendScreenshotsExternally: z.boolean().default(false),
  disabledTeamIds: z.array(z.string()).default([]),
  disabledTemplateKeys: z.array(z.string()).default([]),
  disabledClassifications: z.array(z.enum(CLASSIFICATIONS)).default([]),
  /** Contractual confirmation that content is not used to train external models. */
  noTrainingContractConfirmed: z.boolean().default(false),
});
export type AiPolicy = z.infer<typeof aiPolicySchema>;

export const capturePolicySchema = z.object({
  /** Capture kill switch. */
  enabled: z.boolean().default(true),
  /** Host patterns, e.g. "mybank.com", "*.payroll.example.com". Recording never starts / pauses on these. */
  restrictedDomains: z.array(z.string().max(200)).default([]),
  restrictedApps: z.array(z.string().max(200)).default([]),
  /** CSS selectors the extension always masks in screenshots (administrator-enforced redaction). */
  redactSelectors: z.array(z.string().max(300)).default([]),
  /** Text patterns that trigger automatic screenshot masking of matching elements. */
  redactPatterns: z.array(z.object({ name: z.string().max(60), regex: z.string().max(300) })).default([
    { name: "email", regex: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}" },
    { name: "card-number", regex: "\\b(?:\\d[ -]?){13,19}\\b" },
    { name: "uk-ni-number", regex: "\\b[A-CEGHJ-PR-TW-Z]{2}\\s?\\d{2}\\s?\\d{2}\\s?\\d{2}\\s?[A-D]\\b" },
  ]),
  maxEventsPerSession: z.number().int().min(1).max(1000).default(300),
});
export type CapturePolicy = z.infer<typeof capturePolicySchema>;

export const retentionPolicySchema = z.object({
  searchLogDays: z.number().int().min(1).default(180),
  viewEventDays: z.number().int().min(1).default(365),
  discardedCaptureDays: z.number().int().min(1).default(30),
  staleUnprocessedCaptureDays: z.number().int().min(1).default(60),
});
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

/** Does host match a restricted pattern? Supports exact host, "*.suffix" and bare suffix domains. */
export function hostRestricted(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((p) => {
    const pat = p.trim().toLowerCase();
    if (!pat) return false;
    if (pat.startsWith("*.")) return h === pat.slice(2) || h.endsWith(pat.slice(1));
    return h === pat || h.endsWith("." + pat);
  });
}
