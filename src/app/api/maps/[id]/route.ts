import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { getMap, publishMap, updateMap } from "@/server/services/maps";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => getMap(ctx, params.id));
export const PUT = route<{ id: string }>({}, async ({ ctx, req, params }) => { await updateMap(ctx, params.id, await parseBody(req, z.unknown())); return { ok: true }; });
export const POST = route<{ id: string }>({}, async ({ ctx, params }) => { await publishMap(ctx, params.id); return { ok: true }; });
