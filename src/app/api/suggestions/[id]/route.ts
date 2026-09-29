import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { decideSuggestion } from "@/server/services/suggestions";
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]) }));
  return decideSuggestion(ctx, params.id, b.decision);
});
