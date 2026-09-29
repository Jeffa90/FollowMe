// The AI policy gate. EVERY AI feature (suggestions, assistant) passes through here. Disabling AI never disables the rest of the product.
import { prisma } from "../db";
import type { Ctx } from "../ctx";
import { aiPolicySchema, type AiPolicy } from "../../lib/policy";
import { clearanceAllows, type Classification } from "../../lib/roles";
import { forbidden } from "../errors";
import { configuredExternalProvider, localProvider, type AiProvider } from "./provider";

export async function getAiPolicy(orgId: string): Promise<AiPolicy> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  return aiPolicySchema.parse(org.aiPolicy ?? {});
}

export interface GateInput { templateKey?: string | null; classification?: string | null }
export interface GateResult { policy: AiPolicy; provider: AiProvider; usedExternal: boolean; reason: string }

/**
 * Decide whether AI may be used and which provider. Throws 403 when AI is disabled for the organisation, the user's team, the
 * content type (template) or the security classification. External providers additionally require: explicit org permission,
 * a confirmed no-training contract, and content classified at or below the configured maximum. Images are never sent externally.
 */
export async function gate(ctx: Ctx, input: GateInput = {}): Promise<GateResult> {
  const policy = await getAiPolicy(ctx.orgId);
  if (!policy.enabled) throw forbidden("AI features are disabled by your organisation");
  if (ctx.teamId && policy.disabledTeamIds.includes(ctx.teamId)) throw forbidden("AI features are disabled for your team");
  if (input.templateKey && policy.disabledTemplateKeys.includes(input.templateKey)) throw forbidden("AI features are disabled for this type of content");
  if (input.classification && policy.disabledClassifications.includes(input.classification as never)) throw forbidden(`AI features are disabled for ${input.classification.toLowerCase()} content`);
  const ext = configuredExternalProvider();
  let reason = "No external AI provider is configured; using local rules (no AI model, no network).";
  if (ext) {
    const classOk = !input.classification || clearanceAllows(policy.externalMaxClassification as Classification, input.classification as Classification);
    if (policy.externalAllowed && policy.noTrainingContractConfirmed && classOk) return { policy, provider: ext, usedExternal: true, reason: `External provider ${ext.id} permitted by policy.` };
    reason = !policy.externalAllowed ? "External AI is not permitted by policy; using local rules." : !policy.noTrainingContractConfirmed ? "External AI requires a confirmed no-training agreement; using local rules." : "This content's classification may not be sent externally; using local rules.";
  }
  return { policy, provider: localProvider, usedExternal: false, reason };
}
