"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "./api";

function useAction() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, success = "Done") {
    setErr(""); setOk(""); setBusy(true);
    try { await fn(); setOk(success); router.refresh(); } catch (e) {
      setErr(e instanceof ApiError ? e.message + (Array.isArray(e.details) ? ": " + e.details.map((d: any) => d.message ?? d.path).join("; ") : "") : "Failed");
    } finally { setBusy(false); }
  }
  const msg = (<>{err ? <p role="alert" className="alert danger">{err}</p> : null}{ok ? <p role="status" className="alert ok">{ok}</p> : null}</>);
  return { run, busy, msg, router };
}

export type Perm = { submit: boolean; review: boolean; approve: boolean; publish: boolean; discard: boolean; revise: boolean; urgent: boolean; underReview: boolean; completeReview: boolean; archive: boolean };

export function WorkflowActions({ guideId, workingId, workingStatus, liveId, liveStatus, perms, authors }: { guideId: string; workingId: string | null; workingStatus: string | null; liveId: string | null; liveStatus: string | null; perms: Perm; authors: { id: string; name: string }[] }) {
  const { run, busy, msg } = useAction();
  const [comment, setComment] = useState("");
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [urgentAuthor, setUrgentAuthor] = useState(authors[0]?.id ?? "");
  const wf = (action: string, extra: object = {}) => api(`/api/versions/${workingId}/workflow`, { body: { action, comment, ...extra } });
  return (
    <section className="card" aria-labelledby="wf-h">
      <h2 id="wf-h">Workflow actions</h2>
      {msg}
      {workingId ? (
        <div>
          <p>Working version status: <strong>{workingStatus?.replaceAll("_", " ").toLowerCase()}</strong></p>
          {(perms.review || perms.approve) ? (
            <label className="field">Decision comment <span className="hint">Required when requesting changes or rejecting.</span><textarea value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          ) : null}
          <div className="btn-row">
            {workingStatus === "DRAFT" || workingStatus === "CHANGES_REQUESTED" ? <a className="btn btn-primary" href={`/guides/${guideId}/edit?v=${workingId}`}>Edit content</a> : null}
            {perms.submit ? <button className="btn btn-primary" disabled={busy} onClick={() => run(() => wf("submit"), "Submitted")}>Submit for review</button> : null}
            {perms.review ? (<>
              <button className="btn btn-primary" disabled={busy} onClick={() => run(() => wf("review", { decision: "APPROVE" }), "Review recorded")}>Approve review</button>
              <button className="btn" disabled={busy} onClick={() => run(() => wf("review", { decision: "REQUEST_CHANGES" }), "Changes requested")}>Request changes</button>
            </>) : null}
            {perms.approve ? (<>
              <button className="btn btn-primary" disabled={busy} onClick={() => run(() => wf("approve", { decision: "APPROVE" }), "Approval recorded")}>Approve</button>
              <button className="btn" disabled={busy} onClick={() => run(() => wf("approve", { decision: "REQUEST_CHANGES" }), "Changes requested")}>Request changes</button>
              <button className="btn btn-danger" disabled={busy} onClick={() => run(() => wf("approve", { decision: "REJECT" }), "Rejected")}>Reject</button>
            </>) : null}
            {perms.publish ? <button className="btn btn-primary" disabled={busy} onClick={() => run(() => wf("publish"), "Published")}>Publish</button> : null}
            {perms.discard ? <button className="btn btn-danger" disabled={busy} onClick={() => confirm("Discard this draft?") && run(async () => { await wf("discard"); window.location.href = "/workspace"; }, "Discarded")}>Discard draft</button> : null}
          </div>
        </div>
      ) : <p className="muted">No version is currently being worked on.</p>}

      {liveId && !workingId ? (
        <div style={{ marginTop: 12 }}>
          <h3>Published version ({liveStatus?.replaceAll("_", " ").toLowerCase()})</h3>
          {perms.revise ? (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await api(`/api/guides/${guideId}/revisions`, { body: { summary } }); window.location.href = `/guides/${guideId}/edit?v=${r.versionId}`; }, "Revision started"); }}>
              <label className="field">Start a revision (a new draft; the published version stays live and unchanged)
                <input required minLength={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What will change and why?" /></label>
              <button className="btn btn-primary" disabled={busy} type="submit">Start revision</button>
            </form>
          ) : null}
          <div className="btn-row" style={{ marginTop: 12 }}>
            {perms.underReview && liveStatus === "PUBLISHED" ? <button className="btn" disabled={busy} onClick={() => run(() => api(`/api/guides/${guideId}/lifecycle`, { body: { action: "under_review", note: "Periodic review started" } }), "Marked under review")}>Mark under review</button> : null}
            {perms.completeReview ? <button className="btn" disabled={busy} onClick={() => { const n = prompt("Review note (what was checked?)"); if (n) run(() => api(`/api/guides/${guideId}/lifecycle`, { body: { action: "complete_review", note: n } }), "Review completed; next review date set"); }}>Complete review: no change needed</button> : null}
            {perms.archive ? <button className="btn btn-danger" disabled={busy} onClick={() => { const n = prompt("Reason for archiving/withdrawing this guide?"); if (n) run(() => api(`/api/guides/${guideId}/lifecycle`, { body: { action: "archive", note: n } }), "Archived"); }}>Archive / withdraw</button> : null}
          </div>
          {perms.urgent ? (
            <details style={{ marginTop: 12 }}><summary>Urgent correction (controlled fast-track)</summary>
              <p className="muted">Skips the review phase but still needs an independent approval, is audited, and triggers a mandatory follow-up review.</p>
              <label className="field">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this urgent? (min 10 characters)" /></label>
              <label className="field">Author to draft the correction<select value={urgentAuthor} onChange={(e) => setUrgentAuthor(e.target.value)}>{authors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <button className="btn btn-danger" disabled={busy} onClick={() => run(async () => { const r = await api(`/api/guides/${guideId}/revisions`, { body: { summary: "Urgent correction: " + reason, urgent: { reason, authorId: urgentAuthor } } }); void r; }, "Urgent correction started; the assigned author can now edit it")}>Start urgent correction</button>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function MetadataForm({ guide, users, sites, workflows, canEdit, canGovern }: {
  guide: { id: string; ownerId: string | null; backupOwnerId: string | null; escalationUserId: string | null; escalationPath: string; reviewFrequencyDays: number; siteId: string | null; classification: string; criticality: string; processCode: string | null; functionCode: string | null; businessUnit: string | null; department: string | null; systems: string[]; applications: string[]; websites: string[]; urlPatterns: string[]; sapTransactions: string[]; businessRoles: string[]; categories: string[]; workflowId: string | null };
  users: { id: string; name: string }[]; sites: { id: string; name: string }[]; workflows: { id: string; name: string }[]; canEdit: boolean; canGovern: boolean;
}) {
  const { run, busy, msg } = useAction();
  const [f, setF] = useState({ ...guide, systems: guide.systems.join(", "), applications: guide.applications.join(", "), websites: guide.websites.join(", "), urlPatterns: guide.urlPatterns.join(", "), sapTransactions: guide.sapTransactions.join(", "), businessRoles: guide.businessRoles.join(", "), categories: guide.categories.join(", ") });
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const set = (k: string, v: string | number | null) => setF((p) => ({ ...p, [k]: v }));
  const userSel = (k: "ownerId" | "backupOwnerId" | "escalationUserId", label: string) => (
    <label className="field">{label}<select disabled={!canGovern} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value || null)}><option value="">— none —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
  );
  return (
    <form className="card" aria-labelledby="md-h" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/guides/${guide.id}/metadata`, { method: "PATCH", body: {
      ownerId: f.ownerId, backupOwnerId: f.backupOwnerId, escalationUserId: f.escalationUserId, escalationPath: f.escalationPath, reviewFrequencyDays: Number(f.reviewFrequencyDays), siteId: f.siteId || null,
      classification: f.classification, criticality: f.criticality, processCode: f.processCode || null, functionCode: f.functionCode || null, businessUnit: f.businessUnit || null, department: f.department || null,
      systems: list(f.systems), applications: list(f.applications), websites: list(f.websites), urlPatterns: list(f.urlPatterns), sapTransactions: list(f.sapTransactions), businessRoles: list(f.businessRoles), categories: list(f.categories), workflowId: f.workflowId || null,
    } }), "Metadata saved"); }}>
      <h2 id="md-h">Governance &amp; metadata</h2>
      {msg}
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0 }}>
        <div className="grid cols-3">
          {userSel("ownerId", "Process owner *")}{userSel("backupOwnerId", "Backup owner *")}{userSel("escalationUserId", "Escalation contact")}
          <label className="field">Review frequency (days) *<input type="number" min={7} max={3650} value={f.reviewFrequencyDays} onChange={(e) => set("reviewFrequencyDays", Number(e.target.value))} /></label>
          <label className="field">Site<select value={f.siteId ?? ""} onChange={(e) => set("siteId", e.target.value || null)}><option value="">All sites</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="field">Approval route<select disabled={!canGovern} value={f.workflowId ?? ""} onChange={(e) => set("workflowId", e.target.value || null)}><option value="">Organisation default</option>{workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label className="field">Security classification<select disabled={!canGovern} value={f.classification} onChange={(e) => set("classification", e.target.value)}>{["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"].map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field">Criticality<select disabled={!canGovern} value={f.criticality} onChange={(e) => set("criticality", e.target.value)}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field">Process<input value={f.processCode ?? ""} onChange={(e) => set("processCode", e.target.value)} /></label>
          <label className="field">Function<input value={f.functionCode ?? ""} onChange={(e) => set("functionCode", e.target.value)} /></label>
          <label className="field">Business unit<input value={f.businessUnit ?? ""} onChange={(e) => set("businessUnit", e.target.value)} /></label>
          <label className="field">Department<input value={f.department ?? ""} onChange={(e) => set("department", e.target.value)} /></label>
        </div>
        <label className="field">Escalation path (text)<input value={f.escalationPath} onChange={(e) => set("escalationPath", e.target.value)} /></label>
        <div className="grid cols-2">
          <label className="field">Systems <span className="hint">Comma separated</span><input value={f.systems} onChange={(e) => set("systems", e.target.value)} /></label>
          <label className="field">Applications<input value={f.applications} onChange={(e) => set("applications", e.target.value)} /></label>
          <label className="field">SAP transaction codes<input value={f.sapTransactions} onChange={(e) => set("sapTransactions", e.target.value)} /></label>
          <label className="field">Website domains<input value={f.websites} onChange={(e) => set("websites", e.target.value)} /></label>
          <label className="field">URL patterns <span className="hint">Use * as wildcard</span><input value={f.urlPatterns} onChange={(e) => set("urlPatterns", e.target.value)} /></label>
          <label className="field">Business roles<input value={f.businessRoles} onChange={(e) => set("businessRoles", e.target.value)} /></label>
          <label className="field">Categories<input value={f.categories} onChange={(e) => set("categories", e.target.value)} /></label>
        </div>
        {canEdit ? <button className="btn btn-primary" disabled={busy} type="submit">Save metadata</button> : null}
      </fieldset>
    </form>
  );
}

export function FindingActions({ findingId, accepted }: { findingId: string; accepted: boolean }) {
  const { run, busy, msg } = useAction();
  return (
    <span>
      {msg}
      {accepted ? <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api(`/api/health/${findingId}`, { body: { action: "reopen" } }), "Reopened")}>Reopen</button>
        : <button className="btn btn-sm" disabled={busy} onClick={() => { const r = prompt("Reason for accepting this as an exception (recorded in the audit trail):"); if (r) run(() => api(`/api/health/${findingId}`, { body: { action: "accept", reason: r } }), "Exception accepted"); }}>Accept exception</button>}
    </span>
  );
}

export function RecommendationActions({ id }: { id: string }) {
  const { run, busy, msg } = useAction();
  return (
    <span className="btn-row">
      {msg}
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => api(`/api/recommendations/${id}`, { body: { decision: "ACCEPTED", note: "Accepted" } }), "Accepted: guide marked under review (content unchanged)")}>Accept: begin review</button>
      <button className="btn btn-sm" disabled={busy} onClick={() => { const n = prompt("Why dismiss this recommendation?"); if (n) run(() => api(`/api/recommendations/${id}`, { body: { decision: "DISMISSED", note: n } }), "Dismissed"); }}>Dismiss</button>
    </span>
  );
}

export function FeedbackActions({ guideId, id }: { guideId: string; id: string }) {
  const { run, busy } = useAction();
  return (
    <span className="btn-row">
      <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api(`/api/guides/${guideId}/feedback`, { method: "PATCH", body: { feedbackId: id, status: "ACKNOWLEDGED" } }))}>Acknowledge</button>
      <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api(`/api/guides/${guideId}/feedback`, { method: "PATCH", body: { feedbackId: id, status: "RESOLVED" } }))}>Resolve</button>
    </span>
  );
}

export function CompareForm({ guideId, versions }: { guideId: string; versions: { id: string; label: string }[] }) {
  const [l, setL] = useState(versions[1]?.id ?? versions[0]?.id ?? "");
  const [r, setR] = useState(versions[0]?.id ?? "");
  if (versions.length < 2) return null;
  return (
    <form action={`/guides/${guideId}/compare`} className="btn-row" aria-label="Compare versions">
      <label className="inline">From <select name="left" value={l} onChange={(e) => setL(e.target.value)}>{versions.map((v) => <option key={v.id} value={v.id}>v{v.label}</option>)}</select></label>
      <label className="inline">To <select name="right" value={r} onChange={(e) => setR(e.target.value)}>{versions.map((v) => <option key={v.id} value={v.id}>v{v.label}</option>)}</select></label>
      <button className="btn btn-sm" type="submit">Compare</button>
    </form>
  );
}

type Change = { kind: string; id: string; label: string; before: string; after: string };
export function ReconcileForm({ guideId }: { guideId: string }) {
  const [res, setRes] = useState<{ assetId: string; problems: string[]; changes: Change[]; applicable: boolean; baseVersionLabel: string | null } | null>(null);
  const [accept, setAccept] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  return (
    <section className="card" aria-labelledby="rec-x">
      <h2 id="rec-x">Upload an edited Word copy</h2>
      <p className="muted">Exports are copies, not masters. Edits made to a downloaded copy are compared with the controlled guide; accepted changes become a <strong>new draft</strong> that still needs review and approval.</p>
      <label className="field">Edited .docx export<input type="file" accept=".docx" onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return; setMsg(null); setRes(null);
        try { const fd = new FormData(); fd.set("file", f); const r = await api(`/api/guides/${guideId}/reconcile`, { form: fd }); setRes(r); setAccept(r.changes.filter((c: Change) => !c.id.startsWith("new:") && !c.id.startsWith("removed:")).map((c: Change) => c.id)); } catch (x) { setMsg({ ok: false, t: x instanceof ApiError ? x.message : "Failed" }); }
      }} /></label>
      {res?.problems.map((p, i) => <p key={i} role="alert" className="alert danger">{p}</p>)}
      {res?.applicable ? (
        <>
          <p role="status">{res.changes.length} difference(s) from version {res.baseVersionLabel}.</p>
          <ul style={{ listStyle: "none", padding: 0 }}>{res.changes.map((c) => { const manual = c.id.startsWith("new:") || c.id.startsWith("removed:"); return (
            <li key={c.id} className="card" style={{ marginBottom: 6 }}><label className="inline" style={{ display: "flex" }}><input type="checkbox" disabled={manual} checked={accept.includes(c.id)} onChange={() => setAccept((a) => (a.includes(c.id) ? a.filter((x) => x !== c.id) : [...a, c.id]))} /> <strong>{c.label}</strong></label><div className="diff-removed">Before: {c.before || "—"}</div><div className="diff-added">After: {c.after || "—"}</div></li>); })}</ul>
          <button className="btn btn-primary" disabled={!accept.length} onClick={async () => { try { const r = await api(`/api/guides/${guideId}/reconcile`, { body: { assetId: res.assetId, accept } }); window.location.href = `/guides/${guideId}/edit?v=${r.versionId}`; } catch (x) { setMsg({ ok: false, t: x instanceof ApiError ? x.message : "Failed" }); } }}>Create a draft revision from the selected changes</button>
        </>
      ) : null}
      {msg ? <p role="alert" className="alert danger">{msg.t}</p> : null}
    </section>
  );
}
