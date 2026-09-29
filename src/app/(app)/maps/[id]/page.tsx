import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { hasRole } from "@/server/ctx";
import { getMap } from "@/server/services/maps";
import { PageHead } from "@/components/ui";
import { MapEditor } from "./MapEditor";

export const dynamic = "force-dynamic";
export default async function MapPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const d = await getMap(ctx, id).catch(() => null);
  if (!d) notFound();
  const { map, content, refs, problems } = d;
  const roles = [...new Set(content.nodes.map((n) => n.role).filter(Boolean))];
  return (
    <>
      <PageHead title={map.title} sub={<>Status: <strong>{map.status.toLowerCase()}</strong></>} />
      {map.status === "DRAFT" && hasRole(ctx, "AUTHOR", "PROCESS_OWNER") ? <MapEditor id={map.id} title={map.title} content={content} canPublish={hasRole(ctx, "PROCESS_OWNER", "ADMIN")} problems={problems} /> : null}
      <div className="grid cols-3" style={{ marginTop: 16 }}>
        <section className="card"><h2>Triggers</h2><ul>{content.triggers.map((t, i) => <li key={i}>{t}</li>)}</ul></section>
        <section className="card"><h2>Inputs</h2><ul>{content.inputs.map((t, i) => <li key={i}>{t}</li>)}</ul></section>
        <section className="card"><h2>Outputs</h2><ul>{content.outputs.map((t, i) => <li key={i}>{t}</li>)}</ul></section>
      </div>
      <section className="card" style={{ marginTop: 16 }} aria-labelledby="fl"><h2 id="fl">Flow</h2>
        <p className="muted">Roles involved: {roles.join(", ") || "—"}</p>
        <ol style={{ paddingLeft: 20 }}>
          {content.nodes.map((n) => (
            <li key={n.id} id={`node-${n.id}`}><strong>{n.title}</strong> <span className="badge neutral">{n.type}</span>{n.role ? <> · <em>{n.role}</em></> : null}
              {n.guideDocumentId ? refs[n.guideDocumentId]?.available ? <> · guide: <Link href={`/g/${n.guideDocumentId}`}>{refs[n.guideDocumentId].title}</Link></> : <span className="badge danger" style={{ marginLeft: 6 }}>guide {n.guideDocumentId} unavailable</span> : null}
              {n.controls.length ? <div className="alert warn" style={{ margin: "4px 0" }}>Controls: {n.controls.join("; ")}</div> : null}
              {n.next.length ? <ul>{n.next.map((x, i) => <li key={i}>{x.label ? `${x.label}: ` : "then "}<a href={`#node-${x.to}`}>{content.nodes.find((y) => y.id === x.to)?.title ?? x.to}</a></li>)}</ul> : <div className="muted">End of path</div>}
            </li>
          ))}
        </ol>
      </section>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <section className="card"><h2>Policies</h2><ul>{content.policies.map((t, i) => <li key={i}>{t}</li>)}</ul></section>
        <section className="card"><h2>Forms</h2><ul>{content.forms.map((t, i) => <li key={i}>{t}</li>)}</ul></section>
      </div>
    </>
  );
}
