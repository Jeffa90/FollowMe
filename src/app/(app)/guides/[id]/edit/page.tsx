import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { getVersionDetail, loadGuide } from "@/server/services/guides";
import { prisma } from "@/server/db";
import { Editor } from "@/components/editor/Editor";
import type { TemplateDef } from "@/lib/templates";
import { OPEN_STATUSES } from "@/lib/roles";
import { listSuggestions } from "@/server/services/suggestions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit guide" };

export default async function EditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { v } = await searchParams;
  const guide = await loadGuide(ctx, id).catch(() => null);
  if (!guide) notFound();
  const version = v
    ? await getVersionDetail(ctx, v).catch(() => null)
    : await (async () => { const w = await prisma.guideVersion.findFirst({ where: { guideId: guide.id, status: { in: OPEN_STATUSES } }, orderBy: { number: "desc" } }); return w ? getVersionDetail(ctx, w.id).catch(() => null) : null; })();
  if (!version || version.guideId !== guide.id) redirect(`/guides/${guide.id}`);
  const [tpl, blocks, suggestions] = await Promise.all([
    prisma.template.findUniqueOrThrow({ where: { id: guide.templateId } }),
    prisma.contentBlock.findMany({ where: { orgId: ctx.orgId }, orderBy: { title: "asc" } }),
    listSuggestions(ctx, version.id),
  ]);
  return (
    <Editor guideId={guide.id} versionId={version.id} documentId={guide.documentId} label={version.label} status={version.status} initial={version.content} rev={version.rev}
      template={tpl.definition as unknown as TemplateDef} readOnly={!version.canEdit}
      blocks={blocks.map((b) => ({ id: b.id, key: b.key, kind: b.kind, title: b.title, body: b.body, version: b.version }))}
      suggestions={suggestions.map((s) => ({ id: s.id, kind: s.kind, stepId: s.stepId, provider: s.provider, payload: s.payload as Record<string, unknown>, status: s.status, uncertainty: s.uncertainty as Record<string, unknown> }))} />
  );
}
