import { z } from "zod";
import { parseQuery, route } from "@/server/http";
import { suggestForContext } from "@/server/services/search";
// Future side-panel support: returns published guides associated with the current URL / SAP transaction. Never records anything.
export const GET = route({}, async ({ ctx, url }) => ({ items: await suggestForContext(ctx, parseQuery(url, z.object({ url: z.string().max(2000).optional(), sapTransaction: z.string().max(30).optional(), application: z.string().max(100).optional() }))) }));
