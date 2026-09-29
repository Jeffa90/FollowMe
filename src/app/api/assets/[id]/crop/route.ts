import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { cropAsset } from "@/server/services/assets";
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), guideId: z.string().optional() }));
  const a = await cropAsset(ctx, params.id, b, b.guideId);
  return { id: a.id, width: a.width, height: a.height };
});
