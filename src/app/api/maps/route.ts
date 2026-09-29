import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { createMap, listMaps } from "@/server/services/maps";
export const GET = route({}, async ({ ctx }) => ({ items: await listMaps(ctx) }));
export const POST = route({}, async ({ ctx, req }) => createMap(ctx, await parseBody(req, z.unknown())));
