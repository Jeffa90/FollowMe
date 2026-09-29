"use client";
import { useState } from "react";
import { api, ApiError } from "@/components/api";
import { Inline } from "@/components/GuideBody";

type Answer = { answered: boolean; answer: string; citations: { documentId: string; title: string; versionLabel: string; stepId: string | null; stepNumber: string | null; section: string | null; url: string; quote: string }[]; provider: string; aiInvolved: boolean; disclosure: string; uncertainty: string; policyNote: string; related: { documentId: string; title: string }[] };

export function AskForm({ initialQuestion, documentId }: { initialQuestion: string; documentId?: string }) {
  const [q, setQ] = useState(initialQuestion);
  const [a, setA] = useState<Answer | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); setA(null); try { setA(await api("/api/ask", { body: { question: q, documentId } })); } catch (x) { setErr(x instanceof ApiError ? x.message : "Failed"); } finally { setBusy(false); } }}>
        <label className="field" htmlFor="q">Your question{documentId ? ` (about ${documentId})` : ""}</label>
        <div className="btn-row"><input id="q" className="input" style={{ flex: 1, minWidth: 260 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. How do I create a purchase order in SAP?" /><button className="btn btn-primary" disabled={busy || q.trim().length < 3}>{busy ? "Searching approved guides…" : "Ask"}</button></div>
      </form>
      <div aria-live="polite" style={{ marginTop: 16 }}>
        {err ? <p role="alert" className="alert danger">{err}</p> : null}
        {a ? (
          <section className="card" aria-labelledby="ans-h" data-testid="answer">
            <h2 id="ans-h">{a.answered ? "Answer" : "No approved answer"}</h2>
            <p style={{ whiteSpace: "pre-wrap" }}><Inline text={a.answer} /></p>
            {a.answered ? (
              <>
                <h3>Sources (approved guides)</h3>
                <ul>{a.citations.map((c, i) => <li key={i}><a href={c.url}>{c.title}</a> · {c.documentId} v{c.versionLabel} · {c.stepNumber ? `Step ${c.stepNumber}` : c.section}<br /><span className="muted">“{c.quote}”</span></li>)}</ul>
              </>
            ) : a.related.length ? <p>Closest guides you can access: {a.related.map((r) => <a key={r.documentId} href={`/g/${r.documentId}`} style={{ marginRight: 8 }}>{r.title}</a>)}</p> : null}
            <p className={`alert ${a.aiInvolved ? "info" : "ok"}`}><strong>{a.aiInvolved ? "AI involved" : "No AI model used"}.</strong> {a.disclosure}{a.uncertainty ? ` Uncertainty: ${a.uncertainty}` : ""}</p>
            <p className="muted">{a.policyNote}</p>
          </section>
        ) : null}
      </div>
    </>
  );
}
