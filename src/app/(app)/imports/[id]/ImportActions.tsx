"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/components/api";

export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => { const t = setInterval(() => router.refresh(), 2000); return () => clearInterval(t); }, [router]);
  return <p role="status" className="alert info">Converting… this page refreshes automatically.</p>;
}

export function ImportActions({ id, status, versionId, guideId, unassigned, steps, guides }: { id: string; status: string; versionId: string | null; guideId: string | null; unassigned: { imageId: string; assetId: string }[]; steps: { id: string; label: string }[]; guides: { id: string; label: string }[] }) {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [cmpGuide, setCmpGuide] = useState(guides[0]?.id ?? "");
  const [cmp, setCmp] = useState<any>(null);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const run = async (fn: () => Promise<any>, ok: string) => { setMsg(null); try { await fn(); setMsg({ ok: true, t: ok }); router.refresh(); } catch (e) { setMsg({ ok: false, t: e instanceof ApiError ? e.message : "Failed" }); } };
  return (
    <div className="grid cols-2">
      <section className="card" aria-labelledby="cf-h"><h2 id="cf-h">Human confirmation</h2>
        <p>Imported content is <strong>untrusted</strong> until you confirm it. The draft cannot be submitted for review until you do.</p>
        {status === "NEEDS_REVIEW" ? (
          <>
            <label className="inline" style={{ display: "flex", marginBottom: 8 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have compared the converted content with the original and resolved or accepted the flagged items.</label>
            <label className="field">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <div className="btn-row">
              <button className="btn btn-primary" disabled={!ack} onClick={() => run(() => api(`/api/imports/${id}`, { body: { action: "confirm", acknowledged: true, note } }), "Confirmed. The draft can now be completed and submitted.")}>Confirm converted content</button>
              {versionId ? <a className="btn" href={`/guides/${guideId}/edit?v=${versionId}`}>Open in editor</a> : null}
              <button className="btn btn-danger" onClick={() => { const r = prompt("Reason for rejecting this import? (the source file is kept)"); if (r) run(() => api(`/api/imports/${id}`, { body: { action: "reject", reason: r } }), "Rejected"); }}>Reject</button>
            </div>
          </>
        ) : status === "CONFIRMED" ? <p className="alert ok">Confirmed. <a href={`/guides/${guideId}`}>Continue on the governance page</a> to complete metadata and submit for review.</p>
          : status === "DRY_RUN_OK" ? <button className="btn btn-primary" onClick={() => run(() => api(`/api/imports/${id}`, { body: { action: "materialise" } }), "Draft created")}>Create the draft from this dry run</button>
          : status === "FAILED" ? <button className="btn" onClick={() => run(() => api(`/api/imports/${id}`, { body: { action: "retry" } }), "Retry queued")}>Retry conversion</button>
          : <p className="muted">Status: {status.toLowerCase()}</p>}
        {msg ? <p role={msg.ok ? "status" : "alert"} className={`alert ${msg.ok ? "ok" : "danger"}`} style={{ marginTop: 8 }}>{msg.t}</p> : null}
      </section>
      <section className="card" aria-labelledby="cp-h"><h2 id="cp-h">Compare with an existing guide</h2>
        <p className="muted">Is this a duplicate of, or an update to, something already published?</p>
        <label className="field">Published guide<select value={cmpGuide} onChange={(e) => setCmpGuide(e.target.value)}>{guides.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
        <button className="btn" disabled={!cmpGuide} onClick={async () => { try { setCmp(await api(`/api/imports/${id}`, { body: { action: "compare", guideId: cmpGuide } })); } catch (e) { setMsg({ ok: false, t: e instanceof ApiError ? e.message : "Failed" }); } }}>Compare</button>
        {cmp ? <p role="status">{Object.entries(cmp.summary).map(([k, v]) => `${v} ${k}`).join(", ")} (published → imported)</p> : null}
      </section>
      {unassigned.length && versionId ? (
        <section className="card" aria-labelledby="ua-h" style={{ gridColumn: "1 / -1" }}><h2 id="ua-h">Images that could not be matched to a step</h2>
          {unassigned.map((u) => (
            <div key={u.imageId} className="btn-row" style={{ marginBottom: 8 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assets/${u.assetId}`} alt="Unmatched image from the source document" width={160} />
              <label className="inline">Place on step <select value={assign[u.imageId] ?? ""} onChange={(e) => setAssign({ ...assign, [u.imageId]: e.target.value })}><option value="">Choose…</option>{steps.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
              <button className="btn btn-sm" disabled={!assign[u.imageId]} onClick={() => run(() => api(`/api/imports/${id}`, { body: { action: "assign-image", imageId: u.imageId, stepId: assign[u.imageId] } }), "Image placed on the step")}>Place</button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
