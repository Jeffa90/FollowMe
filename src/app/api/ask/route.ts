import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { ask } from "@/server/ai/qa";
export const POST = route({ limit: [30, 60_000] }, async ({ ctx, req }) => {
  const b = await parseBody(req, z.object({ question: z.string().min(3).max(500), documentId: z.string().max(60).optional() }));
  return ask(ctx, b.question, { documentId: b.documentId });
});
