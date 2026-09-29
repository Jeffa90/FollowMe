"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/components/api";

type B = { id: string; key: string; kind: string; title: string; body: string; version: number; requiresReapproval: boolean };
type Impact = { affected: { documentId: string; title: string; versionLabel: string; status: string; usesVersion: number; upToDate: boolean }[] };
export function BlocksClient({ blocks }: { blocks: B[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<B | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [nb, setNb] = useState({ key: "", kind: "WARNING", title: "", body: "" });
  const pick = async (b: B) => { setSel(b); setTitle(b.title); setBody(b.body); setMsg(null); setImpact(await api(`/api/blocks/${b.id}`)); };
  return (
    <div className="grid cols-2">
      <section className="card" aria-labelledby="bl"><h2 id="bl">Blocks</h2>
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>{blocks.map((b) => <li key={b.id}><button className={`btn ${sel?.id === b.id ? "btn-primary" : ""}`} style={{ width: "100%", justifyContent: "space-between" }} onClick={() => pick(b)}><span>{b.title}</span><span className="muted">{b.kind.toLowerCase()} · v{b.version}</span></button></li>)}</ul>
        <details><summary>Create a block</summary>
          <form onSubmit={async (e) => { e.preventDefault(); try { await api("/api/blocks", { body: { ...nb, requiresReapproval: true } }); setNb({ key: "", kind: "WARNING", title: "", body: "" }); router.refresh(); } catch (x) { setMsg({ ok: false, t: x instanceof ApiError ? x.message : "Failed" }); } }}>
            <label className="field">Key<input required pattern="[a-z0-9-]+" value={nb.key} onChange={(e) => setNb({ ...nb, key: e.target.value })} /></label>
            <label className="field">Kind<select value={nb.kind} onChange={(e) => setNb({ ...nb, kind: e.target.value })}>{["WARNING", "SAFETY", "PRIVACY", "PREREQUISITE", "APPROVAL", "DEFINITION", "ESCALATION"].map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="field">Title<input required value={nb.title} onChange={(e) => setNb({ ...nb, title: e.target.value })} /></label>
            <label className="field">Text<textarea required value={nb.body} onChange={(e) => setNb({ ...nb, body: e.target.value })} /></label>
            <button className="btn btn-primary">Create</button>
          </form>
        </details>
      </section>
      <section className="card" aria-labelledby="ed">
        <h2 id="ed">{sel ? `Change “${sel.title}”` : "Select a block"}</h2>
        {sel && impact ? (
          <>
            <h3>Affected guides ({impact.affected.length})</h3>
            {impact.affected.length ? <ul>{impact.affected.map((a, i) => <li key={i}>{a.documentId} {a.title} v{a.versionLabel} <span className="badge neutral">{a.status.toLowerCase().replace("_", " ")}</span> uses block v{a.usesVersion}{a.upToDate ? "" : " (older)"}</li>)}</ul> : <p className="muted">No guide uses this block yet.</p>}
            <p className="alert warn">Published guides are <strong>not</strong> rewritten. Their owners receive a review recommendation and re-approval is {sel.requiresReapproval ? "required" : "not required"} for this block.</p>
            <label className="field">Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="field">Text<textarea value={body} onChange={(e) => setBody(e.target.value)} /></label>
            <button className="btn btn-primary" onClick={async () => { try { const r = await api(`/api/blocks/${sel.id}`, { method: "PUT", body: { title, body, acknowledgeImpactCount: impact.affected.length } }); setMsg({ ok: true, t: `Saved as v${r.version}. ${r.affected} guide version(s) notified.` }); router.refresh(); } catch (x) { setMsg({ ok: false, t: x instanceof ApiError ? x.message : "Failed" }); } }}>I have reviewed the {impact.affected.length} affected guide(s): save new version</button>
          </>
        ) : null}
        {msg ? <p role={msg.ok ? "status" : "alert"} className={`alert ${msg.ok ? "ok" : "danger"}`} style={{ marginTop: 8 }}>{msg.t}</p> : null}
      </section>
    </div>
  );
}
