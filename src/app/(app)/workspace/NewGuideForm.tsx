"use client";
import { useState } from "react";
import { api, ApiError } from "@/components/api";

export function NewGuideForm({ templates }: { templates: { key: string; name: string; description: string }[] }) {
  const [title, setTitle] = useState("");
  const [tpl, setTpl] = useState(templates[0]?.key ?? "general");
  const [err, setErr] = useState("");
  return (
    <form className="card" aria-labelledby="ng-h" onSubmit={async (e) => {
      e.preventDefault(); setErr("");
      try { const r = await api("/api/guides", { body: { title, templateKey: tpl } }); window.location.href = `/guides/${r.guideId}/edit?v=${r.versionId}`; } catch (x) { setErr(x instanceof ApiError ? x.message : "Failed"); }
    }}>
      <h2 id="ng-h">New guide</h2>
      <div className="grid cols-2">
        <label className="field">Title<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Receive goods in SAP (MIGO)" /></label>
        <label className="field">Template<select value={tpl} onChange={(e) => setTpl(e.target.value)}>{templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select><span className="hint">{templates.find((t) => t.key === tpl)?.description}</span></label>
      </div>
      <button className="btn btn-primary" type="submit">Create draft</button>
      {err ? <p role="alert" className="alert danger" style={{ marginTop: 8 }}>{err}</p> : null}
    </form>
  );
}
