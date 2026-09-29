import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { saveContent } from "@/server/services/guides";
export const PUT = route<{ id: string }>({ limit: [600, 60_000] }, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ content: z.unknown(), rev: z.number().int() }));
  return saveContent(ctx, params.id, b.content, b.rev);
});
