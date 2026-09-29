import { route } from "@/server/http";
import { recordEvent } from "@/server/services/capture";
import { requireScope } from "@/server/session";
export const POST = route<{ id: string }>({ allowToken: true, limit: [900, 60_000] }, async ({ ctx, req, params }) => {
  requireScope(ctx, "capture");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 12 * 1024 * 1024) return new Response(JSON.stringify({ error: { code: "too_large", message: "Event too large" } }), { status: 413 });
  return recordEvent(ctx, params.id, await req.json());
});
