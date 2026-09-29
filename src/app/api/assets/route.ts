import { route } from "@/server/http";
import { storeAsset, IMAGE_KINDS } from "@/server/services/assets";
import { badRequest, forbidden } from "@/server/errors";
import { hasRole } from "@/server/ctx";
import { prisma } from "@/server/db";
import { canSeeGuide } from "@/server/authz";

export const POST = route({ limit: [60, 60_000] }, async ({ ctx, req }) => {
  if (!hasRole(ctx, "AUTHOR")) throw forbidden();
  const form = await req.formData();
  const file = form.get("file");
  const purpose = String(form.get("purpose") ?? "CONTENT");
  const guideId = form.get("guideId") ? String(form.get("guideId")) : undefined;
  if (!(file instanceof File)) throw badRequest("file is required");
  if (!["CONTENT", "ATTACHMENT"].includes(purpose)) throw badRequest("purpose must be CONTENT or ATTACHMENT");
  if (guideId) { const g = await prisma.guide.findFirst({ where: { id: guideId, orgId: ctx.orgId } }); if (!g || !canSeeGuide(ctx, g)) throw badRequest("Unknown guide"); }
  const a = await storeAsset(ctx, { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, purpose: purpose as "CONTENT" | "ATTACHMENT", allow: purpose === "CONTENT" ? IMAGE_KINDS : ["pdf", "docx", "pptx", ...IMAGE_KINDS], guideId });
  return { id: a.id, mime: a.mime, size: a.size, width: a.width, height: a.height, name: a.originalName };
});
