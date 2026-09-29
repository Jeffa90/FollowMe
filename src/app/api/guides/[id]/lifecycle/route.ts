import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { archiveGuide, completeReviewNoChange, markUnderReview } from "@/server/services/guides";
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ action: z.enum(["under_review", "complete_review", "archive"]), note: z.string().max(2000).default("") }));
  if (b.action === "under_review") await markUnderReview(ctx, params.id, b.note);
  else if (b.action === "complete_review") return await completeReviewNoChange(ctx, params.id, b.note);
  else await archiveGuide(ctx, params.id, b.note);
  return { ok: true };
});
