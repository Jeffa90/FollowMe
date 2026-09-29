import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth";
import { getImport } from "@/server/services/imports";
import { prisma } from "@/server/db";
import { guideScope } from "@/server/authz";
import { PageHead, SeverityBadge } from "@/components/ui";
import { AutoRefresh, ImportActions } from "./ImportActions";
import { flattenSteps, numberSteps } from "@/lib/guide-schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review import" };

const conf = (c?: number) => (c === undefined ? null : <span className={`conf ${c < 0.5 ? "conf-low" : c < 0.75 ? "conf-mid" : "conf-high"}`}>{Math.round(c * 100)}%<span className="visually-hidden"> confidence{c < 0.5 ? " (low)" : ""}</span></span>);

export default async function ImportReview({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole("AUTHOR", "ADMIN", "AUDITOR");
  const { id } = await params;
  const data = await getImport(ctx, id).catch(() => null);
  if (!data) notFound();
  const { item, doc, conversion, version } = data;
  if (["QUEUED", "PROCESSING"].includes(item.status)) return <><PageHead title={item.filename} /><AutoRefresh /></>;
  const guides = await prisma.guide.findMany({ where: { AND: [guideScope(ctx), { liveVersionId: { not: null }, archivedAt: null }] }, select: { id: true, documentId: true, title: true } });
  const outcomeOf = new Map((conversion?.changeSummary.blocks ?? []).map((b) => [b.blockId, b]));
  const content = version?.content ?? (conversion as unknown as { content?: NonNullable<typeof version>["content"] })?.content;
  const numbered = content ? numberSteps(content.steps) : [];
  const sc = content?.sectionConfidence ?? {};
  const counts = conversion?.changeSummary.counts;
  const unassigned = (conversion?.imageAssociations ?? []).filter((a) => !a.stepId).map((a) => ({ imageId: a.imageId, assetId: doc?.images.find((i) => i.id === a.imageId)?.assetId ?? "" })).filter((u) => u.assetId);
  const flags = conversion?.flags ?? [];
  return (
    <>
      <PageHead title={item.filename} sub={<>Status: <strong>{item.status.replaceAll("_", " ").toLowerCase()}</strong> · Original: <a href={`/api/assets/${item.sourceAssetId}`}>download the untouched source</a> · Overall confidence {conf(conversion?.overallConfidence)}</>}>
        {item.guideId ? <Link className="btn" href={`/guides/${item.guideId}`}>Governance page</Link> : null}
      </PageHead>
      {item.error ? <p role="alert" className="alert danger">{item.error}</p> : null}
      {doc?.warnings.length ? <ul className="alert warn">{doc.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
      <ImportActions id={item.id} status={item.status} versionId={item.versionId} guideId={item.guideId} unassigned={unassigned}
        steps={content ? flattenSteps(content.steps).filter((s) => s.kind === "action").map((s) => ({ id: s.id, label: s.title.slice(0, 60) })) : []} guides={guides.map((g) => ({ id: g.id, label: `${g.documentId} · ${g.title}` }))} />

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="sm-h"><h2 id="sm-h">Change summary</h2>
        <p role="status">{counts ? `${counts.retained} retained · ${counts.rewritten} rewritten · ${counts.removed} removed · ${counts.uncertain} uncertain` : "—"} <span className="muted">(source blocks by outcome; every block is accounted for)</span></p>
        {flags.length ? <ul style={{ listStyle: "none", padding: 0 }}>{flags.map((f, i) => <li key={i}><SeverityBadge severity={f.severity === "error" ? "BLOCKING_ERROR" : f.severity === "warn" ? "WARNING" : "SUGGESTION"} /> {f.message}</li>)}</ul> : <p className="muted">No flags.</p>}
      </section>

      <div className="split" style={{ marginTop: 16 }}>
        <section className="card" aria-labelledby="src-h"><h2 id="src-h">Original (as extracted)</h2>
          <p className="muted">Colour shows what happened to each part of the original.</p>
          <ol style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {(doc?.blocks ?? []).map((b) => {
              const o = outcomeOf.get(b.id);
              const tone = o?.outcome === "retained" ? "ok" : o?.outcome === "rewritten" ? "info" : o?.outcome === "removed" ? "neutral" : "warn";
              return (
                <li key={b.id} id={`src-${b.id}`} className={`alert ${tone}`} style={{ margin: 0, padding: "6px 10px" }}>
                  <span className="badge neutral">{b.type}{b.page ? ` p${b.page}` : ""}</span> <span className={`badge ${tone}`}>{o?.outcome ?? "?"}</span>{" "}
                  {b.type === "image" && b.imageId ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/assets/${doc!.images.find((i) => i.id === b.imageId)?.assetId}`} alt={`Image from the original (${b.imageId})`} width={200} /> : <span style={{ whiteSpace: "pre-wrap", color: "var(--text)" }}>{b.text.slice(0, 400)}</span>}
                  {o ? <div className="muted" style={{ fontSize: ".8rem" }}>{o.reason}{o.into ? <> → <a href={`#dst-${o.into}`}>{o.into.startsWith("s_") ? "step" : o.into}</a></> : null}</div> : null}
                </li>
              );
            })}
          </ol>
          {doc?.pageImageAssetIds?.length ? <details><summary>Original page images ({doc.pageImageAssetIds.length})</summary>{doc.pageImageAssetIds.map((a, i) => /* eslint-disable-next-line @next/next/no-img-element */ <img key={a} src={`/api/assets/${a}`} alt={`Original page ${i + 1}`} style={{ maxWidth: "100%", border: "1px solid var(--border)", margin: "6px 0" }} />)}</details> : null}
        </section>

        <section className="card" aria-labelledby="dst-h"><h2 id="dst-h">Converted draft</h2>
          {!content ? <p className="muted">No converted content.</p> : (
            <>
              <dl className="meta-grid">
                {(["title", "purpose", "scope", "audience", "expectedResult"] as const).map((k) => (
                  <div key={k} style={{ gridColumn: "1 / -1" }}><dt>{k} {conf(sc[k]?.confidence)}</dt><dd>{content[k] || <em className="muted">empty{sc[k]?.note ? `: ${sc[k].note}` : ""}</em>}</dd></div>
                ))}
              </dl>
              <h3>Steps ({content.steps.length})</h3>
              <ol style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
                {numbered.map((n) => (
                  <li key={n.step.id} id={`dst-${n.step.id}`} className="card" style={{ padding: 10 }}>
                    <strong>{n.number ? `${n.number}. ` : ""}<span className="badge neutral">{n.step.kind}</span> {n.step.title}</strong> {conf(n.step.origin.confidence)}
                    {n.step.text ? <div style={{ whiteSpace: "pre-wrap" }}>{n.step.text}</div> : null}
                    {n.step.image ? <div className="badge info">screenshot{n.step.image.needsReplacement ? " · needs replacement" : ""}</div> : null}
                    {n.step.origin.flags.map((f, i) => <div key={i} className="flag"><span className="badge warn">{f.code}</span> {f.message}</div>)}
                    <div className="muted" style={{ fontSize: ".8rem" }}>From: {(n.step.origin.sourceBlockIds ?? []).map((b) => <a key={b} href={`#src-${b}`} style={{ marginRight: 6 }}>{b}</a>)}</div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
    </>
  );
}
