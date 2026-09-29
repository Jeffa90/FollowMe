import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { assignImage, compareImportWithGuide, confirmImport, getImport, materialiseDryRun, rejectImport, retryImport } from "@/server/services/imports";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => getImport(ctx, params.id));
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ action: z.enum(["confirm", "reject", "retry", "materialise", "assign-image", "compare"]), acknowledged: z.boolean().optional(), note: z.string().max(1000).optional(), reason: z.string().max(500).optional(), imageId: z.string().optional(), stepId: z.string().optional(), guideId: z.string().optional() }));
  switch (b.action) {
    case "confirm": return confirmImport(ctx, params.id, { acknowledged: b.acknowledged, note: b.note ?? "" });
    case "reject": await rejectImport(ctx, params.id, b.reason ?? ""); return { ok: true };
    case "retry": await retryImport(ctx, params.id); return { ok: true };
    case "materialise": return materialiseDryRun(ctx, params.id);
    case "assign-image": await assignImage(ctx, params.id, b.imageId ?? "", b.stepId ?? ""); return { ok: true };
    case "compare": return compareImportWithGuide(ctx, params.id, b.guideId ?? "");
  }
});
