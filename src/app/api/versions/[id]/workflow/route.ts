import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { approvalDecision, discardDraft, publishVersion, reviewDecision, submitForReview } from "@/server/services/guides";
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ action: z.enum(["submit", "review", "approve", "publish", "discard"]), decision: z.enum(["APPROVE", "REJECT", "REQUEST_CHANGES"]).optional(), comment: z.string().max(4000).default(""), effectiveDate: z.string().optional() }));
  switch (b.action) {
    case "submit": return submitForReview(ctx, params.id);
    case "review": return reviewDecision(ctx, params.id, { decision: b.decision ?? "APPROVE", comment: b.comment });
    case "approve": return approvalDecision(ctx, params.id, { decision: b.decision ?? "APPROVE", comment: b.comment });
    case "publish": return publishVersion(ctx, params.id, { effectiveDate: b.effectiveDate });
    case "discard": await discardDraft(ctx, params.id); return { ok: true };
  }
});
