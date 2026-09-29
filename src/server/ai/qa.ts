// The assistant: answers questions from APPROVED, PUBLISHED, AUTHORISED guides only, always with guide + step citations,
// and says clearly when no approved answer exists. Works without AI (extractive local rules).
import { z } from "zod";
import { prisma } from "../db";
import type { Ctx } from "../ctx";
import { gate } from "./policy";
import { buildQaPrompt, SYSTEM_BASE } from "./prompts";
import { retrieveChunks, type RetrievedChunk } from "../services/search";
import { guideContentSchema, numberSteps, stepPlainText, stripInline } from "../../lib/guide-schema";
import { liveUrl } from "../services/library";
import { rateLimit } from "../ratelimit";

export interface Citation { documentId: string; title: string; versionLabel: string; versionId: string; stepId: string | null; stepNumber: string | null; section: string | null; url: string; quote: string }
export interface Answer {
  answered: boolean; answer: string; citations: Citation[]; provider: string; aiInvolved: boolean; disclosure: string; uncertainty: string; policyNote: string;
  related: { documentId: string; title: string }[];
}

const qaSchema = z.object({ answerable: z.boolean(), answer: z.string().max(4000), citations: z.array(z.object({ chunkId: z.string() })).max(10), uncertainty: z.string().max(500).default("") });

export const NO_ANSWER = "No approved answer exists for this question in the guides you can access. Nothing was guessed. Try different words, browse the library, or ask the guide owner.";
const MIN_COVERAGE = 0.6;

async function cite(ctx: Ctx, chunks: RetrievedChunk[]): Promise<Citation[]> {
  const versions = await prisma.guideVersion.findMany({ where: { id: { in: [...new Set(chunks.map((c) => c.versionId))] } } });
  return chunks.map((c) => {
    const v = versions.find((x) => x.id === c.versionId)!;
    const content = guideContentSchema.parse(v.content);
    const n = c.stepId ? numberSteps(content.steps).find((x) => x.step.id === c.stepId) : undefined;
    return {
      documentId: c.documentId, title: c.guideTitle, versionLabel: c.versionLabel, versionId: c.versionId, stepId: c.stepId, stepNumber: n?.number || null,
      section: c.stepId ? null : c.kind === "SECTION" ? "Prerequisites, results and troubleshooting" : "Overview", url: `${liveUrl(c.documentId)}${c.stepId ? `#step-${c.stepId}` : ""}`, quote: stripInline(c.text).slice(0, 300),
    };
  });
}

export async function ask(ctx: Ctx, question: string, opts: { documentId?: string } = {}): Promise<Answer> {
  rateLimit(`ask:${ctx.userId}`, 30, 60_000);
  const q = question.trim().slice(0, 500);
  const g = await gate(ctx); // AI kill switch / team policy (guide-level policy is applied in retrieval)
  const policy = g.policy;
  const { chunks, terms, coverage } = await retrieveChunks(ctx, q, { documentId: opts.documentId, k: 12, disabledTemplateKeys: policy.disabledTemplateKeys, disabledClassifications: policy.disabledClassifications });
  const usable = chunks.filter((c) => coverage(c) >= MIN_COVERAGE);
  // A guide's classification may forbid external use even though local extraction is fine: re-gate per guide when external.
  let provider = "local-rules", aiInvolved = false, policyNote = g.reason;

  const finish = async (a: { answered: boolean; answer: string; chunks: RetrievedChunk[]; uncertainty: string }): Promise<Answer> => {
    const citations = a.answered ? await cite(ctx, a.chunks) : [];
    await prisma.aiQuestion.create({ data: { orgId: ctx.orgId, question: q.slice(0, 300), answered: a.answered, citedGuides: [...new Set(citations.map((c) => c.documentId))], provider } });
    const related = a.answered ? [] : [...new Map(chunks.map((c) => [c.documentId, { documentId: c.documentId, title: c.guideTitle }])).values()].slice(0, 3);
    return {
      answered: a.answered, answer: a.answered ? a.answer : NO_ANSWER, citations, provider, aiInvolved, policyNote, related, uncertainty: a.uncertainty,
      disclosure: aiInvolved ? `This answer was drafted by an AI model (${provider}) from the cited approved steps. Verify it against the cited step before acting.` : "This answer was extracted from the cited approved steps by rules (no AI model was used). Check the cited step before acting.",
    };
  };
  if (!terms.length || usable.length === 0) return finish({ answered: false, answer: "", chunks: [], uncertainty: "" });

  // External model path (only when policy permits for every guide involved)
  if (g.usedExternal) {
    const top = usable.slice(0, 6);
    const guideRows = await prisma.guide.findMany({ where: { id: { in: top.map((c) => c.guideId) } }, select: { classification: true } });
    const allOk = (await Promise.all(guideRows.map((r) => gate(ctx, { classification: r.classification }).then((x) => x.usedExternal).catch(() => false)))).every(Boolean);
    if (allOk) {
      try {
        const versions = await prisma.guideVersion.findMany({ where: { id: { in: top.map((c) => c.versionId) } } });
        const labelled = top.map((c) => { const content = guideContentSchema.parse(versions.find((v) => v.id === c.versionId)!.content); const n = numberSteps(content.steps).find((x) => x.step.id === c.stepId); return { id: c.id, documentId: c.documentId, title: c.guideTitle, stepLabel: n?.number ? `Step ${n.number}` : c.kind.toLowerCase(), text: c.text }; });
        const out = await g.provider.complete({ system: SYSTEM_BASE, prompt: buildQaPrompt(q, labelled), schema: qaSchema, promptId: "qa@1" });
        // Grounding validation: keep only citations that are in the retrieved set; no valid citation => not an answer.
        const valid = out.citations.map((c) => top.find((t) => t.id === c.chunkId)).filter((x): x is RetrievedChunk => !!x);
        provider = g.provider.id; aiInvolved = true;
        if (out.answerable && out.answer.trim() && valid.length) return finish({ answered: true, answer: out.answer.trim(), chunks: valid, uncertainty: out.uncertainty });
        return finish({ answered: false, answer: "", chunks: [], uncertainty: out.answerable ? "The model's answer could not be grounded in a cited approved step and was discarded." : "" });
      } catch { provider = "local-rules"; aiInvolved = false; policyNote = "The external AI provider failed; using local rules."; }
    }
  }

  // Local extractive answer
  const byGuide = new Map<string, { rank: number; chunks: RetrievedChunk[] }>();
  for (const c of usable) { const e = byGuide.get(c.guideId) ?? { rank: 0, chunks: [] }; e.rank += c.rank * coverage(c); e.chunks.push(c); byGuide.set(c.guideId, e); }
  const best = [...byGuide.values()].sort((a, b) => b.rank - a.rank)[0];
  const stepChunks = best.chunks.filter((c) => c.stepId).slice(0, 2);
  const first = best.chunks[0];
  const v = await prisma.guideVersion.findUniqueOrThrow({ where: { id: first.versionId } });
  const content = guideContentSchema.parse(v.content);
  const numbered = numberSteps(content.steps);
  if (stepChunks.length) {
    const lines = stepChunks.map((c) => { const n = numbered.find((x) => x.step.id === c.stepId); return `${n?.number ? `Step ${n.number}` : "Note"}: ${stripInline(stepPlainText(n!.step))}`; });
    return finish({ answered: true, answer: `According to **${first.guideTitle}** (${first.documentId} v${first.versionLabel}):\n${lines.join("\n")}`, chunks: stepChunks, uncertainty: "Extracted verbatim from the best-matching steps; the question may need more than these steps." });
  }
  const outline = numbered.filter((n) => n.number && n.depth === 0).slice(0, 6);
  const outChunks: RetrievedChunk[] = outline.map((n) => ({ ...first, id: `outline-${n.step.id}`, stepId: n.step.id, kind: "STEP", text: stepPlainText(n.step) }));
  return finish({ answered: true, answer: `**${first.guideTitle}** (${first.documentId} v${first.versionLabel}) covers this. Its steps begin:\n${outline.map((n) => `Step ${n.number}: ${stripInline(n.step.title || n.step.text)}`).join("\n")}`, chunks: outChunks, uncertainty: "The question matched the guide overview rather than one specific step." });
}
