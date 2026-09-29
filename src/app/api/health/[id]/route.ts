import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { acceptException, reopenException } from "@/server/services/health";
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ action: z.enum(["accept", "reopen"]), reason: z.string().max(1000).default("") }));
  if (b.action === "accept") await acceptException(ctx, params.id, b.reason); else await reopenException(ctx, params.id);
  return { ok: true };
});
