import Link from "next/link";
import { requireRole } from "@/server/auth";
import { reviewQueue } from "@/server/services/dashboard";
import { PageHead, Empty, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review queue" };

export default async function Review() {
  const ctx = await requireRole("REVIEWER", "APPROVER", "PUBLISHER");
  const q = await reviewQueue(ctx);
  const table = (title: string, rows: typeof q.toReview) => (
    <section key={title} className="card" aria-label={title} style={{ marginBottom: 16 }}><h2>{title} ({rows.length})</h2>
      {rows.length === 0 ? <p className="muted">Nothing waiting.</p> : (
        <div className="table-wrap"><table className="table"><thead><tr><th scope="col">Guide</th><th scope="col">Version</th><th scope="col">Criticality</th><th scope="col">Waiting since</th></tr></thead><tbody>
          {rows.map((v) => <tr key={v.id}><td><Link href={`/guides/${v.guide.id}`}>{v.guide.documentId} · {v.guide.title}</Link></td><td>{v.label}{v.urgent ? " ⚡ urgent" : ""}</td><td>{v.guide.criticality.toLowerCase()}</td><td>{fmtDate(v.submittedAt ?? v.approvedAt)}</td></tr>)}
        </tbody></table></div>
      )}
    </section>
  );
  return (
    <>
      <PageHead title="Review queue" sub="Work waiting on your role. Guides you authored or contributed to are excluded (segregation of duties)." />
      {q.toReview.length + q.toApprove.length + q.toPublish.length === 0 ? <Empty>Nothing needs your attention right now.</Empty> : null}
      {q.toReview.length || q.toApprove.length || q.toPublish.length ? null : null}
      {table("To review (subject-matter check)", q.toReview)}
      {table("To approve", q.toApprove)}
      {table("Ready to publish", q.toPublish)}
    </>
  );
}
