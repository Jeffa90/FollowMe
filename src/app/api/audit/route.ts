import { z } from "zod";
import { parseQuery, route } from "@/server/http";
import { auditLog, auditVerify } from "@/server/services/admin";
export const GET = route({}, async ({ ctx, url }) => {
  const q = parseQuery(url, z.object({ guideId: z.string().optional(), action: z.string().optional(), verify: z.string().optional(), take: z.coerce.number().optional() }));
  if (q.verify) return auditVerify(ctx);
  return { items: await auditLog(ctx, q) };
});
