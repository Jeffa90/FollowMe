import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { startRevision } from "@/server/services/guides";
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ summary: z.string().max(2000).default(""), urgent: z.object({ reason: z.string().max(1000), authorId: z.string().optional() }).optional() }));
  const v = await startRevision(ctx, params.id, b);
  return { versionId: v.id, number: v.number };
});
