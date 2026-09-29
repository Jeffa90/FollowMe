import { route, parseQuery } from "@/server/http";
import { z } from "zod";
import { renderStepImage } from "@/server/services/assets";
export const GET = route<{ id: string; stepId: string }>({ limit: [1200, 60_000] }, async ({ ctx, params, url, req }) => {
  const q = parseQuery(url, z.object({ w: z.coerce.number().int().min(100).max(2400).optional() }));
  const { png, etag } = await renderStepImage(ctx, params.id, params.stepId, { maxWidth: q.w });
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304 });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", etag, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
});
