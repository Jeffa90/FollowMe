import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { addRegistryEntry, listRegistry, revokeToken, updateTemplateDefinition } from "@/server/services/admin";
export const GET = route({}, async ({ ctx }) => listRegistry(ctx));
export const POST = route({}, async ({ ctx, req }) => { await addRegistryEntry(ctx, await parseBody(req, z.unknown())); return { ok: true }; });
export const DELETE = route({}, async ({ ctx, req }) => { const b = await parseBody(req, z.object({ tokenId: z.string() })); await revokeToken(ctx, b.tokenId); return { ok: true }; });
export const PUT = route({}, async ({ ctx, req }) => { const b = await parseBody(req, z.object({ templateId: z.string(), definition: z.unknown() })); await updateTemplateDefinition(ctx, b.templateId, b.definition); return { ok: true }; });
