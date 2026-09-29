import { parseBody, route } from "@/server/http";
import { metadataSchema, updateMetadata } from "@/server/services/guides";
export const PATCH = route<{ id: string }>({}, async ({ ctx, req, params }) => ({ guide: await updateMetadata(ctx, params.id, await parseBody(req, metadataSchema)) }));
