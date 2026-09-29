"use client";
import { useState } from "react";
import { api, ApiError } from "@/components/api";

export function UploadForm({ templates }: { templates: { key: string; name: string }[] }) {
  const [files, setFiles] = useState<FileList | null>(null);
  const [dry, setDry] = useState(false);
  const [name, setName] = useState("");
  const [tpl, setTpl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <form className="card" aria-labelledby="up-h" onSubmit={async (e) => {
      e.preventDefault(); if (!files?.length) return; setErr(""); setBusy(true);
      try {
        const fd = new FormData();
        for (const f of Array.from(files)) fd.append("files", f);
        fd.set("dryRun", String(dry)); if (name) fd.set("batchName", name); if (tpl) fd.set("templateKey", tpl);
        const r = await api("/api/imports", { form: fd });
        window.location.href = files.length === 1 && !dry ? `/imports/${r.items[0].id}` : `/imports/batches/${r.batchId}`;
      } catch (x) { setErr(x instanceof ApiError ? x.message : "Upload failed"); } finally { setBusy(false); }
    }}>
      <h2 id="up-h">Upload</h2>
      <label className="field">Files <span className="hint">DOCX, PDF, PPTX, HTML, Markdown, PNG/JPEG (scans use OCR). Several files make a batch.</span>
        <input type="file" multiple accept=".docx,.pdf,.pptx,.html,.htm,.md,.markdown,.txt,.png,.jpg,.jpeg" onChange={(e) => setFiles(e.target.files)} /></label>
      <div className="grid cols-2">
        <label className="field">Batch name (optional)<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Template (optional)<select value={tpl} onChange={(e) => setTpl(e.target.value)}><option value="">Detect automatically</option>{templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></label>
      </div>
      <label className="inline" style={{ display: "flex", marginBottom: 12 }}><input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} /> Dry run: analyse and report, but do not create any drafts</label>
      <button className="btn btn-primary" type="submit" disabled={busy || !files?.length}>{busy ? "Uploading…" : "Upload and convert"}</button>
      {err ? <p role="alert" className="alert danger" style={{ marginTop: 12 }}>{err}</p> : null}
    </form>
  );
}
