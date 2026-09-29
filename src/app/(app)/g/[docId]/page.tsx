import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { getLiveByDocumentId } from "@/server/services/guides";
import { recordView } from "@/server/services/library";
import { GuidePage } from "@/components/GuidePage";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function LiveGuide({ params, searchParams }: { params: Promise<{ docId: string }>; searchParams: Promise<{ from?: string }> }) {
  const ctx = await requireCtx();
  const { docId } = await params;
  const { from } = await searchParams;
  const res = await getLiveByDocumentId(ctx, docId);
  if (!res) notFound();
  if (!res.version) {
    // Guide exists but nothing is published (yet): only people who can read working versions get a pointer.
    return <div className="card"><h1>{res.guide.title}</h1><p>This guide has not been published yet.</p>{ctx.roles.some((r) => r !== "LEARNER") ? <Link href={`/guides/${res.guide.id}`}>Open governance page</Link> : null}</div>;
  }
  await recordView(ctx, res.guide.id, res.version.id);
  const full = await prisma.guideVersion.findUniqueOrThrow({ where: { id: res.version.id } });
  const notice = from ? <p role="status" className="alert info">You followed a link to an older version ({from}). It has been superseded; this is the current approved version.</p> : null;
  return <GuidePage ctx={ctx} guide={res.guide} version={full} notice={notice} />;
}
