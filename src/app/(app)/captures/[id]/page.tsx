import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth";
import { getSession, previewGeneration } from "@/server/services/capture";
import { prisma } from "@/server/db";
import { PageHead, fmtDateTime } from "@/components/ui";
import { CaptureActions } from "./CaptureActions";
import { OPEN_STATUSES } from "@/lib/roles";
import { guideScope } from "@/server/authz";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recording" };

export default async function CaptureDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole("AUTHOR");
  const { id } = await params;
  const data = await getSession(ctx, id).catch(() => null);
  if (!data) notFound();
  const { session, events } = data;
  const preview = await previewGeneration(ctx, id);
  const [drafts, guides, templates] = await Promise.all([
    prisma.guideVersion.findMany({ where: { orgId: ctx.orgId, status: { in: ["DRAFT", "CHANGES_REQUESTED"] }, guide: guideScope(ctx) }, include: { guide: { select: { documentId: true, title: true } } }, take: 50 }),
    prisma.guide.findMany({ where: { AND: [guideScope(ctx), { archivedAt: null }] }, select: { id: true, documentId: true, title: true }, orderBy: { documentId: "asc" } }),
    prisma.template.findMany({ where: { orgId: ctx.orgId, active: true }, select: { key: true, name: true } }),
  ]);
  const droppedIds = new Map(preview.dropped.map((d) => [d.eventId, d.reason]));
  return (
    <>
      <PageHead title="Recording" sub={`${session.startUrl ?? ""} · ${fmtDateTime(session.startedAt)} · ${session.status.toLowerCase()}`}>
        {session.guideId ? <Link className="btn btn-primary" href={`/guides/${session.guideId}`}>Open generated guide</Link> : null}
      </PageHead>
      <p className="alert info">This is <strong>evidence</strong>: the original recording is preserved separately and is never changed by editing. Typed values, passwords and keystrokes were not captured.</p>
      <CaptureActions sessionId={id} status={session.status} generated={!!session.guideId} suggestedTitle={preview.title} templates={templates} drafts={drafts.map((d) => ({ versionId: d.id, label: `${d.guide.documentId} · ${d.guide.title} (v${d.label})` }))} guides={guides.map((g) => ({ id: g.id, label: `${g.documentId} · ${g.title}` }))} />
      <section className="card" style={{ marginTop: 16 }} aria-labelledby="pv-h"><h2 id="pv-h">What would be generated</h2>
        <p>{preview.steps.length} steps from {events.length} events; {preview.dropped.length} events dropped as low value or duplicate. Application detected: <strong>{preview.application.name}</strong> ({preview.application.host || "unknown host"}).</p>
        <ol>{preview.steps.map((s) => <li key={s.id}>{s.text.replace(/\*\*/g, "")}{s.flags.length ? <span className="badge warn" style={{ marginLeft: 6 }}>{s.flags[0].code}</span> : null}</li>)}</ol>
      </section>
      <section className="card" style={{ marginTop: 16 }} aria-labelledby="ev-h"><h2 id="ev-h">Captured events (evidence)</h2>
        <div className="table-wrap"><table className="table"><thead><tr><th scope="col">#</th><th scope="col">Type</th><th scope="col">Target</th><th scope="col">Page</th><th scope="col">Screenshot</th><th scope="col">Generation</th></tr></thead><tbody>
          {events.map((e) => {
            const t = e.target as { name?: string; label?: string; role?: string };
            return (
              <tr key={e.id}><td>{e.seq}</td><td>{e.type}</td><td>{t.name || t.label || t.role || "—"}</td><td>{e.pageTitle || e.url}</td>
                <td>{e.screenshotAssetId ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/assets/${e.screenshotAssetId}`} alt={`Screenshot for event ${e.seq}`} width={140} /> : "—"}{(e.redactions as unknown[]).length ? <span className="badge ok" style={{ marginLeft: 6 }}>masked</span> : null}</td>
                <td>{droppedIds.has(e.id) ? <span className="muted">dropped: {droppedIds.get(e.id)}</span> : "kept"}</td></tr>
            );
          })}
        </tbody></table></div>
      </section>
    </>
  );
}
