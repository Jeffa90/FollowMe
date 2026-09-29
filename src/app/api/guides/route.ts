import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { createGuide, listWorkspace, metadataSchema } from "@/server/services/guides";
export const GET = route({}, async ({ ctx }) => ({ items: await listWorkspace(ctx) }));
export const POST = route({}, async ({ ctx, req }) => {
  const b = await parseBody(req, z.object({ title: z.string().min(1).max(300), templateKey: z.string().max(60).optional(), metadata: metadataSchema.optional() }));
  const { guide, version } = await createGuide(ctx, b);
  return { guideId: guide.id, documentId: guide.documentId, versionId: version.id };
});
