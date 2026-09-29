import Link from "next/link";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/ctx";
import { hasRole } from "@/server/ctx";
import { GuideBody } from "@/components/GuideBody";
import { StatusBadge, fmtDate } from "@/components/ui";
import { FavouriteButton, FeedbackForm, TrainingPanel } from "@/components/GuideClient";
import { guideContentSchema, numberSteps, type GuideContent } from "@/lib/guide-schema";
import { canEditContent, isOwnerOrAdmin } from "@/server/authz";
import { liveUrl } from "@/server/services/library";
import { LIVE_STATUSES } from "@/lib/roles";

type GuideRow = NonNullable<Awaited<ReturnType<typeof prisma.guide.findFirst>>>;
type VersionRow = NonNullable<Awaited<ReturnType<typeof prisma.guideVersion.findFirst>>>;

/** Renders a guide version for reading. Used by the live view, historical view and embed. */
export async function GuidePage({ ctx, guide, version, notice, embed }: { ctx: Ctx; guide: GuideRow; version: VersionRow; notice?: React.ReactNode; embed?: boolean }) {
  const content: GuideContent = guideContentSchema.parse(version.content);
  const live = LIVE_STATUSES.includes(version.status as never);
  const snap = (version.controlSnapshot ?? {}) as { owner?: string; site?: string; publishedAt?: string; approvals?: { stage: string; by: string; at: string }[] };
  const [owner, site, fav, ack] = await Promise.all([
    guide.ownerId ? prisma.user.findUnique({ where: { id: guide.ownerId }, select: { name: true, active: true } }) : null,
    guide.siteId ? prisma.site.findUnique({ where: { id: guide.siteId } }) : null,
    prisma.favourite.findUnique({ where: { userId_guideId: { userId: ctx.userId, guideId: guide.id } } }),
    prisma.acknowledgement.findFirst({ where: { userId: ctx.userId, versionId: version.id, kind: "ACKNOWLEDGED" } }),
  ]);
  const imageFor = (s: { id: string; image?: { alt: string } }) =>
    s.image ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="shot" loading="lazy" src={`/api/versions/${version.id}/steps/${s.id}/image?w=1000`} alt={s.image.alt || ""} />
    ) : null;
  const canManage = canEditContent(ctx, guide) || isOwnerOrAdmin(ctx, guide) || hasRole(ctx, "AUDITOR", "PUBLISHER", "REVIEWER", "APPROVER");
  const stepsForFeedback = numberSteps(content.steps).filter((n) => n.number).map((n) => ({ id: n.step.id, label: `Step ${n.number}: ${n.step.title.slice(0, 50)}` }));
  const url = liveUrl(guide.documentId);
  return (
    <article className="guide" style={{ maxWidth: embed ? 900 : undefined }}>
      <div className="page-head">
        <div>
          <p className="muted" style={{ margin: 0 }}>{guide.documentId} · Version {version.label}</p>
          <h1>{content.title}</h1>
          <StatusBadge status={version.status} />
        </div>
        {!embed ? (
          <div className="btn-row no-print">
            <Link className="btn btn-primary" href={`/g/${guide.documentId}/guided`}>Guided view</Link>
            <FavouriteButton guideId={guide.id} initial={!!fav} />
            <details className="btn" style={{ padding: 0 }}><summary style={{ padding: "8px 14px", cursor: "pointer", fontWeight: 600 }}>Export</summary>
              <div style={{ padding: 10, display: "grid", gap: 6, position: "absolute", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, zIndex: 5 }}>
                {["docx:Word (.docx)", "pdf:PDF", "html:HTML", "md:Markdown", "zip:Offline package (.zip)"].map((f) => { const [k, l] = f.split(":"); return <a key={k} href={`/api/versions/${version.id}/export?format=${k}`}>{l}</a>; })}
              </div>
            </details>
            {canManage ? <Link className="btn" href={`/guides/${guide.id}`}>Governance</Link> : null}
            <Link className="btn" href={`/ask?guide=${guide.documentId}`}>Ask about this guide</Link>
          </div>
        ) : null}
      </div>
      {notice}
      {version.status === "UNDER_REVIEW" ? <p className="alert warn" role="status"><strong>Under review.</strong> This is still the current approved version, but the owner is reviewing it. Report anything that looks wrong.</p> : null}
      {live ? null : <p className="alert warn"><strong>Not the live version.</strong> This version is {version.status.toLowerCase().replace("_", " ")} and must not be used for work.</p>}
      <p className="banner-controlled">Controlled document. Printed or downloaded copies are uncontrolled. Check the live source for the current version: <a href={url}>{url}</a></p>
      <dl className="meta-grid">
        <div><dt>Document ID</dt><dd>{guide.documentId}</dd></div>
        <div><dt>Version</dt><dd>{version.label}</dd></div>
        <div><dt>Published</dt><dd>{fmtDate(version.publishedAt)}</dd></div>
        <div><dt>Effective</dt><dd>{fmtDate(version.effectiveDate)}</dd></div>
        <div><dt>Review due</dt><dd>{fmtDate(version.reviewDate)}</dd></div>
        <div><dt>Process owner</dt><dd>{snap.owner ?? owner?.name ?? "—"}{owner && !owner.active ? " (inactive)" : ""}</dd></div>
        <div><dt>Site</dt><dd>{snap.site ?? site?.name ?? "All sites"}</dd></div>
        <div><dt>Classification</dt><dd>{guide.classification}</dd></div>
        {guide.systems.length ? <div><dt>Systems</dt><dd>{guide.systems.join(", ")}</dd></div> : null}
        {guide.sapTransactions.length ? <div><dt>SAP transactions</dt><dd>{guide.sapTransactions.join(", ")}</dd></div> : null}
      </dl>
      {version.revisionSummary ? <p><strong>Revision summary:</strong> {version.revisionSummary}</p> : null}
      <GuideBody content={content} imageFor={imageFor} />
      {live && !embed ? (
        <>
          <TrainingPanel versionId={version.id} required={{ ack: content.competency.acknowledgementRequired, quiz: content.competency.quizRequired }} quiz={content.competency.quiz.map((q) => ({ question: q.question, options: q.options }))} />
          {ack ? <p className="muted no-print">You acknowledged this version on {fmtDate(ack.at)}.</p> : null}
          <div className="grid cols-2 no-print" style={{ marginTop: 16 }}>
            <FeedbackForm guideId={guide.id} steps={stepsForFeedback} />
            <section className="card" aria-labelledby="share-h">
              <h2 id="share-h">Share</h2>
              <p>Permanent link (always the current version): <a href={`/g/${guide.documentId}`}>{url}</a></p>
              <p>Short link: <code>/s/{guide.shortCode}</code></p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="qr" src={`/api/guides/${guide.id}/qr`} width={120} height={120} alt={`QR code linking to ${guide.documentId}`} />
              <p className="muted">Embed in SharePoint or Teams: <code>/embed/g/{guide.documentId}</code></p>
            </section>
          </div>
        </>
      ) : null}
    </article>
  );
}
