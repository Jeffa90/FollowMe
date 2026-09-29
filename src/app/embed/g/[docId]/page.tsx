import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { getLiveByDocumentId } from "@/server/services/guides";
import { GuidePage } from "@/components/GuidePage";
import { prisma } from "@/server/db";
import { recordView } from "@/server/services/library";

export const dynamic = "force-dynamic";
// Read-only published view for embedding in SharePoint / Teams / intranet pages. Framing is allowed for this path only (see proxy.ts).
export default async function Embed({ params }: { params: Promise<{ docId: string }> }) {
  const ctx = await requireCtx().catch(() => redirect("/login"));
  const { docId } = await params;
  const res = await getLiveByDocumentId(ctx, docId);
  if (!res?.version) notFound();
  await recordView(ctx, res.guide.id, res.version.id, "embed");
  const v = await prisma.guideVersion.findUniqueOrThrow({ where: { id: res.version.id } });
  return <main id="main" style={{ padding: 16 }}><GuidePage ctx={ctx} guide={res.guide} version={v} embed /></main>;
}
