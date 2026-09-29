import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { compareSessionWithGuide } from "@/server/services/capture";
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ guideId: z.string(), fileRecommendation: z.boolean().default(false) }));
  return compareSessionWithGuide(ctx, params.id, b.guideId, { fileRecommendation: b.fileRecommendation });
});
