import Link from "next/link";
import { requireCtx } from "@/server/auth";
import { myTraining } from "@/server/services/training";
import { PageHead, Empty, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Training" };
export default async function Training() {
  const ctx = await requireCtx();
  const rows = await myTraining(ctx);
  return (
    <>
      <PageHead title="My training records" sub="Only what you have actually recorded: acknowledgements, quizzes and sign-offs. Opening a guide is not counted as competency." />
      {rows.length === 0 ? <Empty>No training records yet. Open a guide and use “I have read and understood”, take its knowledge check, or ask your trainer for a sign-off.</Empty> : (
        <div className="table-wrap"><table className="table"><thead><tr><th scope="col">Guide</th><th scope="col">Read</th><th scope="col">Acknowledged</th><th scope="col">Quiz</th><th scope="col">Competency</th></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id}><td><Link href={`/g/${r.documentId}`}>{r.title}</Link></td><td>{r.read ? "Yes" : "—"}</td>
              <td>{r.acknowledged.length ? r.acknowledged.map((a, i) => <div key={i}>{fmtDate(a.at)} {a.current ? "" : <span className="badge warn">older version</span>}</div>) : "—"}</td>
              <td>{r.quizPassed ? "Passed" : "—"}</td>
              <td>{r.competency.length ? r.competency.map((c, i) => <div key={i}>{c.outcome.replaceAll("_", " ").toLowerCase()} {fmtDate(c.signedAt)}{c.reassessOn ? ` · reassess by ${fmtDate(c.reassessOn)}` : ""}{c.current ? "" : " (older version)"}</div>) : "—"}</td></tr>
          ))}
        </tbody></table></div>
      )}
    </>
  );
}
