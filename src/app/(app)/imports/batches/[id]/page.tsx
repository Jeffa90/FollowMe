import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth";
import { getBatch } from "@/server/services/imports";
import { PageHead, fmtDateTime } from "@/components/ui";
import { AutoRefresh } from "../../[id]/ImportActions";

export const dynamic = "force-dynamic";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole("AUTHOR", "ADMIN", "AUDITOR", "PROCESS_OWNER");
  const { id } = await params;
  const data = await getBatch(ctx, id).catch(() => null);
  if (!data) notFound();
  const { batch, items, totals } = data;
  const groups = new Map<string, typeof items>();
  for (const i of items) { const g = i.groupKeys as { process?: string; system?: string; site?: string }; const key = [g?.process, g?.system, g?.site].filter(Boolean).join(" · ") || "Ungrouped"; groups.set(key, [...(groups.get(key) ?? []), i]); }
  return (
    <>
      <PageHead title={batch.name} sub={`${batch.dryRun ? "Dry run: no drafts created. " : ""}Created ${fmtDateTime(batch.createdAt)} · ${batch.status.toLowerCase()}`}>
        <a className="btn" href={`/api/imports/batches/${batch.id}/report`}>Download exception report (CSV)</a>
      </PageHead>
      {totals.pending > 0 ? <AutoRefresh /> : null}
      <section className="card" aria-labelledby="rc-h"><h2 id="rc-h">Reconciliation</h2>
        <p role="status" className={`alert ${totals.balanced ? "ok" : "danger"}`}>{totals.balanced ? "Every submitted file is accounted for." : "Totals do not reconcile: investigate before continuing."}</p>
        <dl className="meta-grid">
          {Object.entries(totals).filter(([k]) => k !== "balanced").map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="stat" style={{ fontSize: "1.4rem" }}>{String(v)}</dd></div>)}
        </dl>
        <p className="muted">submitted = converted + duplicates + failed + rejected + pending. Source files are never deleted or overwritten.</p>
      </section>
      {[...groups].map(([key, list]) => (
        <section key={key} className="card" style={{ marginTop: 16 }} aria-label={`Group ${key}`}><h2>{key} ({list.length})</h2>
          <div className="table-wrap"><table className="table"><thead><tr><th scope="col">File</th><th scope="col">Status</th><th scope="col">Notes</th><th scope="col"><span className="visually-hidden">Open</span></th></tr></thead><tbody>
            {list.map((i) => {
              const w = (i.warnings as { message?: string; code: string }[]) ?? [];
              return <tr key={i.id}><td>{i.filename}</td><td>{i.status.replaceAll("_", " ").toLowerCase()}</td><td>{i.error ?? w.map((x) => x.message).filter(Boolean).slice(0, 2).join(" ") ?? ""}</td><td>{["REJECTED", "DUPLICATE"].includes(i.status) && !i.error ? null : <Link href={`/imports/${i.id}`}>Review</Link>}</td></tr>;
            })}
          </tbody></table></div>
        </section>
      ))}
    </>
  );
}
