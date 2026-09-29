import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { analyzeEditedExport, applyReconciliation } from "@/server/services/reconcile";
import { badRequest } from "@/server/errors";
export const POST = route<{ id: string }>({ limit: [20, 60_000] }, async ({ ctx, req, params }) => {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const f = (await req.formData()).get("file");
    if (!(f instanceof File)) throw badRequest("file is required");
    return analyzeEditedExport(ctx, params.id, { name: f.name, buffer: Buffer.from(await f.arrayBuffer()) });
  }
  return applyReconciliation(ctx, params.id, await parseBody(req, z.unknown()));
});
