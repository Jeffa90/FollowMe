import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { prisma } from "@/server/db";
import { canReadVersion, canSeeGuide } from "@/server/authz";
import { GuidePage } from "@/components/GuidePage";
import { LIVE_STATUSES, type GuideStatus } from "@/lib/roles";

export const dynamic = "force-dynamic";

// Permanent links to old versions: live -> current page; superseded -> redirect to the current guide unless the viewer is
// authorised for history (auditors etc.), in which case the historical version is shown with an unmistakable banner.
export default async function Historical({ params }: { params: Promise<{ docId: string; n: string }> }) {
  const ctx = await requireCtx();
  const { docId, n } = await params;
  const guide = await prisma.guide.findFirst({ where: { orgId: ctx.orgId, documentId: docId } });
  if (!guide || !canSeeGuide(ctx, guide)) notFound();
  const v = await prisma.guideVersion.findFirst({ where: { guideId: guide.id, number: Number(n) || -1 } });
  if (!v) notFound();
  if (LIVE_STATUSES.includes(v.status as GuideStatus)) redirect(`/g/${docId}`);
  if (!canReadVersion(ctx, guide, v.status as GuideStatus)) {
    if (guide.liveVersionId) redirect(`/g/${docId}?from=v${n}`);
    notFound();
  }
  const current = guide.liveVersionId ? await prisma.guideVersion.findUnique({ where: { id: guide.liveVersionId } }) : null;
  return (
    <GuidePage ctx={ctx} guide={guide} version={v} notice={
      <p role="status" className="alert danger"><strong>Historical version ({v.status.toLowerCase()}).</strong> Shown for audit only.{current ? <> The current version is <Link href={`/g/${docId}`}>{current.label}</Link>.</> : null}</p>
    } />
  );
}
