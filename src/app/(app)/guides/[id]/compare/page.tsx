import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { getVersionDetail, loadGuide } from "@/server/services/guides";
import { compareContent } from "@/lib/compare";
import { PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";
export default async function ComparePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ left?: string; right?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { left, right } = await searchParams;
  const g = await loadGuide(ctx, id).catch(() => null);
  if (!g || !left || !right) notFound();
  const [l, r] = await Promise.all([getVersionDetail(ctx, left), getVersionDetail(ctx, right)]);
  if (l.guideId !== g.id || r.guideId !== g.id) notFound();
  const d = compareContent(l.content, r.content);
  return (
    <>
      <PageHead title={`Compare versions of ${g.documentId}`} sub={`v${l.label} → v${r.label}`}><Link className="btn" href={`/guides/${g.id}`}>Back</Link></PageHead>
      <p role="status">{d.summary.changed} changed · {d.summary.added} added · {d.summary.removed} removed · {d.summary.moved} moved · {d.summary.unchanged} unchanged</p>
      <section className="card"><h2>Sections</h2>
        <table className="table"><thead><tr><th scope="col">Section</th><th scope="col">v{l.label}</th><th scope="col">v{r.label}</th></tr></thead><tbody>
          {d.sections.filter((s) => s.status === "changed").map((s) => <tr key={s.key} className="diff-changed"><th scope="row">{s.key}</th><td style={{ whiteSpace: "pre-wrap" }}>{s.left || "—"}</td><td style={{ whiteSpace: "pre-wrap" }}>{s.right || "—"}</td></tr>)}
          {d.sections.every((s) => s.status === "unchanged") ? <tr><td colSpan={3} className="muted">No section text changed.</td></tr> : null}
        </tbody></table>
      </section>
      <section className="card" style={{ marginTop: 16 }}><h2>Steps</h2>
        <table className="table"><thead><tr><th scope="col">Change</th><th scope="col">v{l.label}</th><th scope="col">v{r.label}</th></tr></thead><tbody>
          {d.steps.map((s, i) => <tr key={i} className={`diff-${s.status === "unchanged" || s.status === "moved" ? "" : s.status}`}><th scope="row">{s.status}{s.changes.length ? ` (${s.changes.join(", ")})` : ""}</th><td>{s.left?.text ?? "—"}</td><td>{s.right?.text ?? "—"}</td></tr>)}
        </tbody></table>
      </section>
    </>
  );
}
