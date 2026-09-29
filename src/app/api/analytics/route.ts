import { z } from "zod";
import { parseQuery, route } from "@/server/http";
import { analytics } from "@/server/services/analytics";
export const GET = route({}, async ({ ctx, url }) => analytics(ctx, parseQuery(url, z.object({ days: z.coerce.number().int().min(7).max(730).optional() }))));
