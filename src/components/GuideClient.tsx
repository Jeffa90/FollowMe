"use client";
import { useState } from "react";
import { api, ApiError } from "./api";
import { useToast } from "./Toasts";

export function FavouriteButton({ guideId, initial }: { guideId: string; initial: boolean }) {
  const [fav, setFav] = useState(initial);
  const toast = useToast();
  return (
    <button className="btn" aria-pressed={fav} onClick={async () => { const r = await api(`/api/guides/${guideId}/favourite`, { method: "POST" }); setFav(r.favourite); toast(r.favourite ? "Added to favourites" : "Removed from favourites"); }}>
      {fav ? "★ Favourite" : "☆ Add to favourites"}
    </button>
  );
}

export function FeedbackForm({ guideId, steps }: { guideId: string; steps: { id: string; label: string }[] }) {
  const [kind, setKind] = useState("RATING");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [stepId, setStepId] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/guides/${guideId}/feedback`, { body: { kind, rating: kind === "RATING" ? rating : undefined, comment, stepId: stepId || undefined } });
      setMsg({ ok: true, text: "Thank you. Your feedback goes to the guide owner (not attributed to you in reports)." }); setComment(""); setRating(0);
    } catch (err) { setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Failed" }); }
  }
  return (
    <form onSubmit={submit} className="card" aria-labelledby="fb-h">
      <h2 id="fb-h">Was this guide helpful?</h2>
      <label className="field">Type of feedback
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="RATING">Rate this guide</option><option value="OUTDATED">Report: this is out of date</option><option value="UNCLEAR">Report: unclear</option><option value="BROKEN_LINK">Report: broken link or missing file</option><option value="OTHER">Other</option>
        </select>
      </label>
      {kind === "RATING" ? (
        <fieldset><legend>Rating</legend>
          <div className="btn-row">{[1, 2, 3, 4, 5].map((n) => <label key={n} className="inline"><input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} /> {n}</label>)}</div>
        </fieldset>
      ) : null}
      <label className="field">Which step? (optional)
        <select value={stepId} onChange={(e) => setStepId(e.target.value)}><option value="">Whole guide</option>{steps.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
      </label>
      <label className="field">Comment<textarea value={comment} onChange={(e) => setComment(e.target.value)} /></label>
      <button className="btn btn-primary" type="submit">Send feedback</button>
      {msg ? <p role={msg.ok ? "status" : "alert"} className={`alert ${msg.ok ? "ok" : "danger"}`} style={{ marginTop: 12 }}>{msg.text}</p> : null}
    </form>
  );
}

export function TrainingPanel({ versionId, required, quiz }: { versionId: string; required: { ack: boolean; quiz: boolean }; quiz?: { question: string; options: string[] }[] }) {
  const [msg, setMsg] = useState("");
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<{ score: number; total: number; passed: boolean } | null>(null);
  async function post(action: string, extra: object = {}) {
    try { const r = await api(`/api/versions/${versionId}/training`, { body: { action, ...extra } }); return r; } catch (e) { setMsg(e instanceof ApiError ? e.message : "Failed"); }
  }
  return (
    <section className="card no-print" aria-labelledby="tr-h">
      <h2 id="tr-h">Training</h2>
      <p className="muted">Opening this guide does not count as competency. Record what you have actually done:</p>
      <div className="btn-row">
        <button className="btn" onClick={async () => { if (await post("read")) setMsg("Marked as read."); }}>Mark as read</button>
        <button className={`btn ${required.ack ? "btn-primary" : ""}`} onClick={async () => { if (await post("acknowledge")) setMsg("Acknowledgement recorded for this version."); }}>I have read and understood this instruction{required.ack ? " (required)" : ""}</button>
      </div>
      {quiz?.length ? (
        <form onSubmit={async (e) => { e.preventDefault(); const r = await post("quiz", { answers }); if (r) setResult(r); }} style={{ marginTop: 12 }}>
          <h3>Knowledge check{required.quiz ? " (required)" : ""}</h3>
          {quiz.map((q, i) => (
            <fieldset key={i}><legend>{q.question}</legend>
              {q.options.map((o, j) => <label key={j} className="inline" style={{ display: "flex" }}><input type="radio" name={`q${i}`} checked={answers[i] === j} onChange={() => setAnswers((a) => { const n = [...a]; n[i] = j; return n; })} /> {o}</label>)}
            </fieldset>
          ))}
          <button className="btn" type="submit" disabled={answers.filter((x) => x !== undefined).length < quiz.length}>Submit answers</button>
          {result ? <p role="status" className={`alert ${result.passed ? "ok" : "warn"}`}>Score {result.score}/{result.total}. {result.passed ? "Passed." : "Not yet passed; review the guide and try again."}</p> : null}
        </form>
      ) : null}
      {msg ? <p role="status" className="alert info" style={{ marginTop: 12 }}>{msg}</p> : null}
    </section>
  );
}
