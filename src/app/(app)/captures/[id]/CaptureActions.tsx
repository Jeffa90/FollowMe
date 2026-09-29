"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/components/api";

type Diff = { diff: { steps: { status: string; similarity: number; left?: { text: string }; right?: { text: string } }[]; summary: Record<string, number> }; mismatches: number; recommendationId: string | null };
export function CaptureActions({ sessionId, status, generated, suggestedTitle, templates, drafts, guides }: { sessionId: string; status: string; generated: boolean; suggestedTitle: string; templates: { key: string; name: string }[]; drafts: { versionId: string; label: string }[]; guides: { id: string; label: string }[] }) {
  const router = useRouter();
  const [title, setTitle] = useState(suggestedTitle);
  const [tpl, setTpl] = useState("general");
  const [draft, setDraft] = useState(drafts[0]?.versionId ?? "");
  const [guide, setGuide] = useState(guides[0]?.id ?? "");
  const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const [cmp, setCmp] = useState<Diff | null>(null);
  const run = async (fn: () => Promise<void>) => { setErr(""); setOk(""); try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : "Failed"); } };
  const active = status === "RECORDING" || status === "PAUSED";
  return (
    <div className="grid cols-2">
      <section className="card" aria-labelledby="gen-h"><h2 id="gen-h">Create a guide</h2>
        {active ? <p className="alert warn">Recording is still {status.toLowerCase()}. Stop it from the extension first.</p> : null}
        <label className="field">Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field">Template<select value={tpl} onChange={(e) => setTpl(e.target.value)}>{templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></label>
        <button className="btn btn-primary" disabled={active || generated} onClick={() => run(async () => { const r = await api(`/api/capture/sessions/${sessionId}/generate`, { body: { title, templateKey: tpl } }); window.location.href = `/guides/${r.guideId}/edit?v=${r.versionId}`; })}>{generated ? "Already generated" : "Generate draft guide"}</button>
        <h3>…or add missed steps to an existing draft</h3>
        <label className="field">Draft<select value={draft} onChange={(e) => setDraft(e.target.value)}>{drafts.length ? null : <option value="">No drafts</option>}{drafts.map((d) => <option key={d.versionId} value={d.versionId}>{d.label}</option>)}</select></label>
        <button className="btn" disabled={active || !draft || generated} onClick={() => run(async () => { const r = await api(`/api/capture/sessions/${sessionId}/append`, { body: { versionId: draft } }); setOk(`Inserted ${r.inserted} steps at the end of the draft.`); router.refresh(); })}>Append recorded steps</button>
        {ok ? <p role="status" className="alert ok" style={{ marginTop: 8 }}>{ok}</p> : null}
        {err ? <p role="alert" className="alert danger" style={{ marginTop: 8 }}>{err}</p> : null}
      </section>
      <section className="card" aria-labelledby="cmp-h"><h2 id="cmp-h">Compare with an existing instruction</h2>
        <p className="muted">Find out whether a process changed: compare this recording with the current guide. Nothing is modified; you may file a review recommendation.</p>
        <label className="field">Guide<select value={guide} onChange={(e) => setGuide(e.target.value)}>{guides.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
        <div className="btn-row">
          <button className="btn" disabled={active || !guide} onClick={() => run(async () => setCmp(await api(`/api/capture/sessions/${sessionId}/compare`, { body: { guideId: guide } })))}>Compare</button>
          <button className="btn" disabled={active || !guide} onClick={() => run(async () => { const r = await api(`/api/capture/sessions/${sessionId}/compare`, { body: { guideId: guide, fileRecommendation: true } }); setCmp(r); setOk(r.recommendationId ? "Review recommendation filed for the owner." : "No differences, so no recommendation was filed."); })}>Compare and file recommendation</button>
        </div>
        {cmp ? (
          <div style={{ marginTop: 12 }}>
            <p role="status"><strong>{cmp.mismatches}</strong> difference(s): {Object.entries(cmp.diff.summary).map(([k, v]) => `${v} ${k}`).join(", ")}</p>
            <table className="table"><thead><tr><th scope="col">Result</th><th scope="col">Existing guide</th><th scope="col">New recording</th></tr></thead><tbody>
              {cmp.diff.steps.filter((s) => s.status !== "unchanged").map((s, i) => <tr key={i} className={`diff-${s.status}`}><th scope="row">{s.status === "removed" ? "Missing in recording" : s.status === "added" ? "New in recording" : s.status}</th><td>{s.left?.text ?? "—"}</td><td>{s.right?.text ?? "—"}</td></tr>)}
            </tbody></table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
