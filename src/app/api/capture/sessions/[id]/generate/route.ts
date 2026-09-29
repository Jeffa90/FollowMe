import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { generateGuideFromSession } from "@/server/services/capture";
import { metadataSchema } from "@/server/services/guides";
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ title: z.string().max(300).optional(), templateKey: z.string().max(60).optional(), metadata: metadataSchema.optional() }).default({}));
  return generateGuideFromSession(ctx, params.id, b);
});
