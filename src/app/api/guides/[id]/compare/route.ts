import { route, parseQuery } from "@/server/http";
import { z } from "zod";
import { compareContent } from "@/lib/compare";
import { getVersionDetail, loadGuide } from "@/server/services/guides";
import { notFound } from "@/server/errors";
export const GET = route<{ id: string }>({}, async ({ ctx, params, url }) => {
  const { left, right } = parseQuery(url, z.object({ left: z.string(), right: z.string() }));
  const g = await loadGuide(ctx, params.id);
  const [l, r] = await Promise.all([getVersionDetail(ctx, left), getVersionDetail(ctx, right)]);
  if (l.guideId !== g.id || r.guideId !== g.id) throw notFound("Version");
  return { left: { id: l.id, label: l.label }, right: { id: r.id, label: r.label }, diff: compareContent(l.content, r.content) };
});
