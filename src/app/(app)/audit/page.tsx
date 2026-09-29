import { requireRole } from "@/server/auth";
import { auditLog, auditVerify } from "@/server/services/admin";
import { PageHead, fmtDateTime } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit" };
export default async function Audit({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const ctx = await requireRole("AUDITOR", "ADMIN");
  const { action } = await searchParams;
  const [rows, chain] = await Promise.all([auditLog(ctx, { action: action || undefined, take: 300 }), auditVerify(ctx)]);
  return (
    <>
      <PageHead title="Audit trail" sub="Append-only and hash-chained: every status change, approval, publication, export, AI suggestion decision and administrative change." />
      <p role="status" className={`alert ${chain.ok ? "ok" : "danger"}`}>{chain.ok ? `Hash chain verified: ${chain.checked} events, no tampering detected.` : `Hash chain BROKEN at sequence ${chain.brokenAtSeq}.`}</p>
      <form method="get" className="btn-row" style={{ marginBottom: 12 }}><label className="inline">Filter by action <input name="action" defaultValue={action ?? ""} placeholder="e.g. PUBLISHED" /></label><button className="btn btn-sm">Filter</button></form>
      <div className="table-wrap"><table className="table"><thead><tr><th scope="col">#</th><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Summary</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.seq.toString()}</td><td>{fmtDateTime(r.at)}</td><td>{r.actorLabel}</td><td><code>{r.action}</code></td><td>{r.summary}</td></tr>)}
      </tbody></table></div>
    </>
  );
}
