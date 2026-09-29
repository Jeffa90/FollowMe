import { route } from "@/server/http";
import { readAsset } from "@/server/services/assets";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => {
  const { asset, buffer } = await readAsset(ctx, params.id);
  const inline = asset.mime.startsWith("image/");
  return new Response(new Uint8Array(buffer), { headers: { "content-type": asset.mime, "content-disposition": `${inline ? "inline" : "attachment"}; filename="${asset.originalName}"`, "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "cache-control": "private, max-age=300" } });
});
