import { requireRole } from "@/server/auth";
import { analytics } from "@/server/services/analytics";
import { PageHead, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 60px", gap: 8, alignItems: "center" }}><div><div>{label}</div><div style={{ background: "var(--surface-2)", borderRadius: 4, height: 10 }}><div style={{ width: `${max ? Math.max(3, (value / max) * 100) : 0}%`, background: "var(--primary)", height: 10, borderRadius: 4 }} role="presentation" /></div></div><strong>{value}</strong></div>;
}

export default async function Analytics({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await requireRole("PROCESS_OWNER", "ADMIN", "AUDITOR", "PUBLISHER");
  const days = Number((await searchParams).days) || 90;
  const a = await analytics(ctx, { days });
  return (
    <>
      <PageHead title="Process analytics" sub={`Last ${days} days. ${a.notice}`}>
        <form method="get" className="inline"><label>Period <select name="days" defaultValue={days}>{[30, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}</select></label><button className="btn btn-sm">Apply</button></form>
      </PageHead>
      <div className="grid cols-3">
        <div className="card"><div className="stat">{a.usage.views}</div>guide views</div>
        <div className="card"><div className="stat">{pct(a.search.successRate)}</div>search success ({a.search.total} searches)</div>
        <div className="card"><div className="stat">{a.feedback.averageRating?.toFixed(1) ?? "—"}</div>average rating ({a.feedback.ratings})</div>
        <div className="card"><div className="stat">{a.reviews.overdue}</div>guides overdue for review</div>
        <div className="card"><div className="stat">{a.reviews.dueIn30Days}</div>due in 30 days</div>
        <div className="card"><div className="stat">{a.publication.medianDaysSubmitToPublish?.toFixed(1) ?? "—"}</div>median days, submit → publish</div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <section className="card" aria-labelledby="tg"><h2 id="tg">Most used guides</h2>{a.usage.topGuides.length ? a.usage.topGuides.map((g) => <Bar key={g.documentId} label={g.title} value={g.views} max={a.usage.topGuides[0].views} />) : <p className="muted">No views yet.</p>}</section>
        <section className="card" aria-labelledby="fs"><h2 id="fs">Failed searches (content gaps)</h2>{a.search.failed.length ? <table className="table"><thead><tr><th scope="col">Query</th><th scope="col">Times</th></tr></thead><tbody>{a.search.failed.map((f) => <tr key={f.query}><td>{f.query}</td><td>{f.count}</td></tr>)}</tbody></table> : <p className="muted">None.</p>}</section>
        <section className="card" aria-labelledby="uq"><h2 id="uq">Unanswered assistant questions</h2>{a.unansweredQuestions.length ? <table className="table"><thead><tr><th scope="col">Question</th><th scope="col">Times</th></tr></thead><tbody>{a.unansweredQuestions.map((f) => <tr key={f.question}><td>{f.question}</td><td>{f.count}</td></tr>)}</tbody></table> : <p className="muted">None.</p>}</section>
        <section className="card" aria-labelledby="ou"><h2 id="ou">Outdated-content reports &amp; low ratings</h2>
          {a.feedback.outdatedReports.map((o) => <p key={o.documentId}>{o.documentId} {o.title}: <strong>{o.open}</strong> open report(s)</p>)}
          {a.feedback.lowestRated.map((o) => <p key={o.documentId}>{o.documentId} {o.title}: average {o.average.toFixed(1)} ({o.count} ratings)</p>)}
          {!a.feedback.outdatedReports.length && !a.feedback.lowestRated.length ? <p className="muted">None.</p> : null}
        </section>
        <section className="card" aria-labelledby="pl"><h2 id="pl">Publication pipeline</h2>{Object.entries(a.pipeline).map(([k, v]) => <Bar key={k} label={k.replaceAll("_", " ").toLowerCase()} value={v as number} max={Math.max(1, ...Object.values(a.pipeline) as number[])} />)}<p className="muted">Median days create → publish: {a.publication.medianDaysCreateToPublish?.toFixed(1) ?? "—"} · urgent corrections: {a.publication.urgentCorrections}</p></section>
        {a.legacy ? <section className="card" aria-labelledby="lg"><h2 id="lg">Legacy conversion</h2><p>{a.legacy.submitted} submitted · {a.legacy.converted} converted · {a.legacy.confirmed} confirmed · {a.legacy.rejected} rejected · {a.legacy.failed} failed · {a.legacy.duplicates} duplicates</p><p>Acceptance rate {pct(a.legacy.acceptanceRate)} · mean conversion confidence {pct(a.legacy.meanConfidence)}</p></section> : null}
        <section className="card" aria-labelledby="hh"><h2 id="hh">Content health</h2><p>{a.health.blocking} blocking · {a.health.warnings} warnings · {a.health.acceptedExceptions} accepted exceptions · {a.health.guidesWithNearDuplicates} guide(s) with near-duplicates</p></section>
        <section className="card" aria-labelledby="tr"><h2 id="tr">Training completion (aggregate)</h2>
          {a.training.length ? <table className="table"><thead><tr><th scope="col">Guide</th><th scope="col">In audience</th><th scope="col">Acknowledged</th><th scope="col">Quiz passed</th><th scope="col">Competent</th></tr></thead><tbody>{a.training.map((t) => <tr key={t.documentId}><td>{t.documentId} {t.title}</td><td>{t.audience}</td><td>{t.acknowledged}</td><td>{t.quizPassed}</td><td>{t.competent}</td></tr>)}</tbody></table> : <p className="muted">No guides require acknowledgement or competency.</p>}
          <p className="muted">Counts only. No individual scoring. Generated {fmtDate(new Date())}.</p></section>
      </div>
    </>
  );
}
