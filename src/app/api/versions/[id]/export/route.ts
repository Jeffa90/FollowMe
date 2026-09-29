import { z } from "zod";
import { parseQuery, route } from "@/server/http";
import { exportVersion } from "@/server/services/exports";

export const GET = route<{ id: string }>({ limit: [30, 60_000] }, async ({ ctx, params, url }) => {
  const { format } = parseQuery(url, z.object({ format: z.string() }));
  const r = await exportVersion(ctx, params.id, format);
  return new Response(new Uint8Array(r.buffer), { headers: { "content-type": r.contentType, "content-disposition": `attachment; filename="${r.filename}"`, "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'", "cache-control": "no-store" } });
});
