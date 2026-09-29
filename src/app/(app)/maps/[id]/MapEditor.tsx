"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/components/api";
import type { MapContent } from "@/lib/process-map";

export function MapEditor({ id, title, content, canPublish, problems }: { id: string; title: string; content: MapContent; canPublish: boolean; problems: string[] }) {
  const router = useRouter();
  const [c, setC] = useState(content); const [t, setT] = useState(title);
  const [msg, setMsg] = useState<{ ok: boolean; t: string; list?: string[] } | null>(null);
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const save = async () => { try { await api(`/api/maps/${id}`, { method: "PUT", body: { title: t, content: c } }); setMsg({ ok: true, t: "Saved" }); router.refresh(); } catch (e) { setMsg({ ok: false, t: e instanceof ApiError ? e.message : "Failed" }); } };
  return (
    <section className="card" aria-labelledby="me"><h2 id="me">Edit draft map</h2>
      <label className="field">Title<input value={t} onChange={(e) => setT(e.target.value)} /></label>
      <div className="grid cols-3">
        {(["triggers", "inputs", "outputs", "policies", "forms"] as const).map((k) => <label key={k} className="field">{k} <span className="hint">One per line</span><textarea value={c[k].join("\n")} onChange={(e) => setC({ ...c, [k]: lines(e.target.value) })} /></label>)}
      </div>
      <h3>Steps</h3>
      {c.nodes.map((n, i) => (
        <fieldset key={i}><legend>Step {i + 1}</legend>
          <div className="grid cols-3">
            <label className="field">Id<input value={n.id} onChange={(e) => setC({ ...c, nodes: c.nodes.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })} /></label>
            <label className="field">Type<select value={n.type} onChange={(e) => setC({ ...c, nodes: c.nodes.map((x, j) => (j === i ? { ...x, type: e.target.value as never } : x)) })}>{["task", "decision", "handoff", "control", "exception"].map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="field">Title<input value={n.title} onChange={(e) => setC({ ...c, nodes: c.nodes.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} /></label>
            <label className="field">Role<input value={n.role} onChange={(e) => setC({ ...c, nodes: c.nodes.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} /></label>
            <label className="field">Guide document ID<input value={n.guideDocumentId ?? ""} onChange={(e) => setC({ ...c, nodes: c.nodes.map((x, j) => (j === i ? { ...x, guideDocumentId: e.target.value || undefined } : x)) })} placeholder="WI-0001" /></label>
            <label className="field">Next <span className="hint">id or id:label, comma separated</span><input value={n.next.map((x) => (x.label ? `${x.to}:${x.label}` : x.to)).join(", ")} onChange={(e) => setC({ ...c, nodes: c.nodes.map((x, j) => (j === i ? { ...x, next: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [to, ...l] = s.split(":"); return { to: to.trim(), label: l.join(":").trim() }; }) } : x)) })} /></label>
          </div>
          <label className="field">Controls <span className="hint">One per line</span><textarea value={n.controls.join("\n")} onChange={(e) => setC({ ...c, nodes: c.nodes.map((x, j) => (j === i ? { ...x, controls: lines(e.target.value) } : x)) })} /></label>
          <button type="button" className="btn btn-sm" onClick={() => setC({ ...c, nodes: c.nodes.filter((_, j) => j !== i) })}>Remove step</button>
        </fieldset>
      ))}
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setC({ ...c, nodes: [...c.nodes, { id: `n${c.nodes.length + 1}`, type: "task", title: "", role: "", controls: [], next: [] }] })}>Add step</button>
        <button type="button" className="btn btn-primary" onClick={save}>Save draft</button>
        {canPublish ? <button type="button" className="btn" onClick={async () => { try { await save(); await api(`/api/maps/${id}`, { method: "POST" }); setMsg({ ok: true, t: "Published" }); router.refresh(); } catch (e) { setMsg({ ok: false, t: e instanceof ApiError ? e.message : "Failed", list: Array.isArray((e as ApiError).details) ? ((e as ApiError).details as string[]) : undefined }); } }}>Validate and publish</button> : null}
      </div>
      {problems.length ? <ul className="alert warn">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
      {msg ? <div role={msg.ok ? "status" : "alert"} className={`alert ${msg.ok ? "ok" : "danger"}`}>{msg.t}{msg.list ? <ul>{msg.list.map((p, i) => <li key={i}>{p}</li>)}</ul> : null}</div> : null}
    </section>
  );
}
