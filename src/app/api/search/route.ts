import { z } from "zod";
import { parseQuery, route } from "@/server/http";
import { searchLibrary } from "@/server/services/search";
export const GET = route({ limit: [120, 60_000] }, async ({ ctx, url }) => {
  const q = parseQuery(url, z.object({ q: z.string().max(200), siteId: z.string().optional(), processCode: z.string().optional(), ownerId: z.string().optional(), system: z.string().optional(), category: z.string().optional(), status: z.enum(["PUBLISHED", "UNDER_REVIEW"]).optional(), reviewBefore: z.string().optional(), reviewAfter: z.string().optional() }));
  const { q: query, ...filters } = q;
  return searchLibrary(ctx, query, filters);
});
