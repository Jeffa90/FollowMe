import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { appendSessionToVersion } from "@/server/services/capture";
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ versionId: z.string(), afterStepId: z.string().optional() }));
  return appendSessionToVersion(ctx, b.versionId, params.id, b.afterStepId);
});
