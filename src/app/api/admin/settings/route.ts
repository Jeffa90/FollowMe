import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { getSettings, updateSettings } from "@/server/services/admin";
export const GET = route({}, async ({ ctx }) => getSettings(ctx));
export const PUT = route({}, async ({ ctx, req }) => updateSettings(ctx, await parseBody(req, z.unknown())));
