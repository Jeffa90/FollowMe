import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { getLiveByDocumentId } from "@/server/services/guides";
import { GuidedView } from "./GuidedView";
import { numberSteps } from "@/lib/guide-schema";

export const dynamic = "force-dynamic";
export default async function Guided({ params }: { params: Promise<{ docId: string }> }) {
  const ctx = await requireCtx();
  const { docId } = await params;
  const res = await getLiveByDocumentId(ctx, docId);
  if (!res?.version) notFound();
  const steps = numberSteps(res.version.content.steps).map((n) => ({ step: n.step, number: n.number, depth: n.depth }));
  return <GuidedView documentId={res.guide.documentId} versionId={res.version.id} title={res.version.content.title} versionLabel={res.version.label} steps={steps} />;
}
