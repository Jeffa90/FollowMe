import { route } from "@/server/http";
import { qrSvg } from "@/server/services/library";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) =>
  new Response(await qrSvg(ctx, params.id), { headers: { "content-type": "image/svg+xml", "content-security-policy": "sandbox; default-src 'none'", "cache-control": "private, max-age=3600" } }));
