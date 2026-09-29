import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { resolveRecommendation } from "@/server/services/health";
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ decision: z.enum(["ACCEPTED", "DISMISSED"]), note: z.string().max(2000).default("") }));
  return resolveRecommendation(ctx, params.id, b.decision, b.note);
});
