import { route } from "@/server/http";
import { createImports, listImports } from "@/server/services/imports";
import { badRequest } from "@/server/errors";

export const GET = route({}, async ({ ctx }) => listImports(ctx));
export const POST = route({ limit: [20, 60_000] }, async ({ ctx, req }) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) throw badRequest("Attach one or more files (field name: files)");
  const loaded = await Promise.all(files.map(async (f) => ({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) })));
  return createImports(ctx, loaded, { batchName: String(form.get("batchName") ?? "") || undefined, dryRun: form.get("dryRun") === "true", templateKey: String(form.get("templateKey") ?? "") || undefined });
});
