"use client";
import { useState } from "react";
import { STEP_KINDS, STEP_KIND_LABELS, newId, newStep, numberSteps, type Step, type StepKind } from "@/lib/guide-schema";
import { deleteStep, duplicateStep, insertStep, mergeWithNext, moveStep, splitStep, updateStep } from "@/lib/step-ops";
import { api, ApiError } from "../api";
import { AnnotatedImage } from "./AnnotatedImage";

export interface Block { id: string; key: string; kind: string; title: string; body: string; version: number }
export interface StepCtx {
  guideId: string; versionId: string; blocks: Block[]; allowedKinds: StepKind[];
  openAnnotate: (stepId: string) => void; selectedId: string | null; setSelected: (id: string) => void; flash: (m: string) => void;
}
type OnChange = (next: Step[], coalesceKey?: string) => void;

export function StepList({ steps, onChange, ctx, prefix = "" }: { steps: Step[]; onChange: OnChange; ctx: StepCtx; prefix?: string }) {
  const numbered = numberSteps(steps, prefix);
  const top = numbered.filter((n) => n.depth === 0);
  const [addKind, setAddKind] = useState<StepKind>("action");
  const [blockId, setBlockId] = useState("");

  const add = (kind: StepKind, at: number) => {
    if (kind === "block") {
      const b = ctx.blocks.find((x) => x.id === blockId);
      if (!b) { ctx.flash("Choose a reusable block first"); return; }
      const s = newStep("block", { title: b.title, text: "", blockRef: { blockId: b.id, version: b.version, kind: b.kind, title: b.title, body: b.body } });
      onChange(insertStep(steps, at, s)); ctx.setSelected(s.id); return;
    }
    const s = newStep(kind);
    onChange(insertStep(steps, at, s)); ctx.setSelected(s.id);
  };

  return (
    <div>
      <ol className="steps" style={{ listStyle: "none", padding: 0 }}>
        {top.map((n, idx) => (
          <StepEditor key={n.step.id} step={n.step} number={n.number} index={idx} count={steps.length} steps={steps} onChange={onChange} ctx={ctx} onInsertBelow={() => add("action", idx + 1)} />
        ))}
      </ol>
      <div className="btn-row no-print" role="group" aria-label="Add a step">
        <label className="inline">Add <select aria-label="Kind of step to add" value={addKind} onChange={(e) => setAddKind(e.target.value as StepKind)}>
          {STEP_KINDS.filter((k) => ctx.allowedKinds.includes(k)).map((k) => <option key={k} value={k}>{STEP_KIND_LABELS[k]}</option>)}
        </select></label>
        {addKind === "block" ? <select aria-label="Reusable block" value={blockId} onChange={(e) => setBlockId(e.target.value)}><option value="">Choose block…</option>{ctx.blocks.map((b) => <option key={b.id} value={b.id}>{b.title} (v{b.version})</option>)}</select> : null}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => add(addKind, steps.length)}>Add step</button>
      </div>
    </div>
  );
}

function StepEditor({ step, number, index, count, steps, onChange, ctx, onInsertBelow }: { step: Step; number: string; index: number; count: number; steps: Step[]; onChange: OnChange; ctx: StepCtx; onInsertBelow: () => void }) {
  const set = (patch: Partial<Step>, key?: string) => onChange(updateStep(steps, step.id, patch), key ? `${step.id}:${key}` : undefined);
  const selected = ctx.selectedId === step.id;
  const label = number ? `Step ${number}` : STEP_KIND_LABELS[step.kind];
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData(); fd.set("file", file); fd.set("purpose", "CONTENT"); fd.set("guideId", ctx.guideId);
      const a = await api("/api/assets", { form: fd });
      set({ image: { assetId: a.id, alt: step.image?.alt ?? "", annotations: [], sourceAssetId: step.image?.sourceAssetId ?? step.image?.assetId } });
      ctx.flash("Image added. Describe it in the alt text field.");
    } catch (e) { ctx.flash(e instanceof ApiError ? e.message : "Upload failed"); } finally { setBusy(false); }
  }
  async function regenerate() {
    try {
      const r = await api(`/api/versions/${ctx.versionId}/steps/${step.id}/regenerate`, { method: "POST" });
      if (confirm(`Replace this step's wording with the text generated from the original recording?\n\n${r.text}`)) set({ title: r.title, text: r.text });
    } catch (e) { ctx.flash(e instanceof ApiError ? e.message : "Could not regenerate"); }
  }

  return (
    <li className={`step-edit${selected ? " selected" : ""}`} id={`edit-${step.id}`} onFocusCapture={() => ctx.setSelected(step.id)}>
      <div className="bar" role="group" aria-label={`${label} actions`}>
        <strong>{label}</strong>
        <select aria-label={`${label} type`} value={step.kind} onChange={(e) => set({ kind: e.target.value as StepKind, ...(e.target.value === "decision" && !step.decision ? { decision: newStep("decision").decision } : {}), ...(e.target.value === "exception" && !step.exception ? { exception: { condition: "" } } : {}) })}>
          {STEP_KINDS.filter((k) => ctx.allowedKinds.includes(k) || k === step.kind).map((k) => <option key={k} value={k}>{STEP_KIND_LABELS[k]}</option>)}
        </select>
        <button type="button" className="btn btn-sm icon-btn" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onChange(moveStep(steps, step.id, -1))}>↑</button>
        <button type="button" className="btn btn-sm icon-btn" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onChange(moveStep(steps, step.id, 1))}>↓</button>
        <button type="button" className="btn btn-sm" onClick={() => onChange(duplicateStep(steps, step.id).steps)}>Duplicate</button>
        <button type="button" className="btn btn-sm" onClick={onInsertBelow}>Insert below</button>
        <button type="button" className="btn btn-sm" disabled={index === count - 1 || !!step.decision} onClick={() => onChange(mergeWithNext(steps, step.id))}>Merge with next</button>
        <button type="button" className="btn btn-sm" onClick={() => { const before = steps.length; const next = splitStep(steps, step.id); if (next.length === before) ctx.flash("Nothing to split: put a line break or a second sentence in the text."); else onChange(next); }}>Split</button>
        <button type="button" className="btn btn-sm btn-danger" onClick={() => { if (confirm(`Delete ${label}?`)) onChange(deleteStep(steps, step.id)); }}>Delete</button>
        {step.origin.type === "capture" ? <button type="button" className="btn btn-sm" onClick={regenerate}>Regenerate from recording</button> : null}
        {step.origin.type === "ai" ? <span className="badge info">Accepted suggestion ({step.origin.provider ?? "ai"})</span> : null}
        {step.origin.type === "import" ? <span className="badge neutral">Imported{step.origin.confidence !== undefined ? ` · ${Math.round(step.origin.confidence * 100)}%` : ""}</span> : null}
      </div>
      <div className="body">
        {step.origin.flags.length ? <ul className="flag" style={{ margin: "0 0 8px" }}>{step.origin.flags.map((f, i) => <li key={i}><span className="badge warn">{f.code}</span> {f.message}</li>)}</ul> : null}
        {step.kind === "block" && step.blockRef ? (
          <div className="alert warn"><strong>{step.blockRef.title}</strong> (reusable block v{step.blockRef.version}): {step.blockRef.body}<br /><span className="muted">Edit this block centrally in Reusable blocks; changes are reviewed for every guide that uses it.</span>
            {(() => { const cur = ctx.blocks.find((b) => b.id === step.blockRef!.blockId); return cur && cur.version > step.blockRef!.version ? <span> <span className="badge warn">Newer version v{cur.version} available</span> <button type="button" className="btn btn-sm" onClick={() => set({ blockRef: { ...step.blockRef!, version: cur.version, title: cur.title, body: cur.body }, title: cur.title })}>Update to latest</button></span> : null; })()}</div>
        ) : (
          <>
            <label className="field">Title <span className="hint">Short, action-oriented headline (e.g. “Click Save”).</span>
              <input value={step.title} onChange={(e) => set({ title: e.target.value }, "title")} />
            </label>
            <label className="field">Instruction <span className="hint">Use **bold** for on-screen names.</span>
              <textarea value={step.text} onChange={(e) => set({ text: e.target.value }, "text")} />
            </label>
          </>
        )}
        {step.kind === "exception" ? <label className="field">When does this exception apply?<input value={step.exception?.condition ?? ""} onChange={(e) => set({ exception: { condition: e.target.value } }, "cond")} /></label> : null}
        {step.kind === "physical" ? (
          <div className="grid cols-2">
            <label className="field">Location<input value={step.physical?.location ?? ""} onChange={(e) => set({ physical: { ...step.physical, location: e.target.value } }, "loc")} /></label>
            <label className="field">Equipment<input value={step.physical?.equipment ?? ""} onChange={(e) => set({ physical: { ...step.physical, equipment: e.target.value } }, "eq")} /></label>
          </div>
        ) : null}
        {step.kind === "decision" && step.decision ? (
          <fieldset><legend>Decision point</legend>
            <label className="field">Question<input value={step.decision.question} onChange={(e) => set({ decision: { ...step.decision!, question: e.target.value } }, "q")} /></label>
            {step.decision.branches.map((b, bi) => (
              <div key={b.id} className="branch">
                <div className="btn-row">
                  <label className="field" style={{ margin: 0, flex: 1 }}>Path label<input value={b.label} onChange={(e) => set({ decision: { ...step.decision!, branches: step.decision!.branches.map((x) => (x.id === b.id ? { ...x, label: e.target.value } : x)) } }, `b${bi}`)} /></label>
                  {step.decision!.branches.length > 2 ? <button type="button" className="btn btn-sm" onClick={() => set({ decision: { ...step.decision!, branches: step.decision!.branches.filter((x) => x.id !== b.id) } })}>Remove path</button> : null}
                </div>
                <StepList steps={b.steps} prefix={`${number}.${String.fromCharCode(65 + bi)}.`} ctx={ctx}
                  onChange={(next, key) => onChange(updateStep(steps, step.id, { decision: { ...step.decision!, branches: step.decision!.branches.map((x) => (x.id === b.id ? { ...x, steps: next } : x)) } }), key)} />
              </div>
            ))}
            {step.decision.branches.length < 6 ? <button type="button" className="btn btn-sm" onClick={() => set({ decision: { ...step.decision!, branches: [...step.decision!.branches, { id: newId("b"), label: "Other", steps: [] }] } })}>Add alternate path</button> : null}
          </fieldset>
        ) : null}

        {step.kind !== "block" ? (
          <fieldset><legend>Screenshot</legend>
            {step.image ? (
              <>
                <AnnotatedImage assetId={step.image.assetId} annotations={step.image.annotations} alt={step.image.alt} width={420} />
                <label className="field" style={{ marginTop: 8 }}>Alt text <span className="hint">Required for accessibility: describe what the screenshot shows.</span>
                  <input value={step.image.alt} onChange={(e) => set({ image: { ...step.image!, alt: e.target.value } }, "alt")} />
                </label>
                <div className="btn-row">
                  <button type="button" className="btn btn-sm" onClick={() => ctx.openAnnotate(step.id)}>Annotate / redact / crop</button>
                  <label className="btn btn-sm" style={{ cursor: "pointer" }}>{busy ? "Uploading…" : "Replace image"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="visually-hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
                  {step.image.needsReplacement ? (
                    <button type="button" className="btn btn-sm" onClick={() => set({ image: { ...step.image!, needsReplacement: false, replaceReason: undefined }, origin: { ...step.origin, flags: [...step.origin.flags.filter((f) => f.code !== "replace-screenshot"), { code: "screenshot-confirmed", message: "Author confirmed the existing screenshot is still accurate.", severity: "info" }] } })}>Confirm this screenshot is still accurate</button>
                  ) : <button type="button" className="btn btn-sm" onClick={() => set({ image: { ...step.image!, needsReplacement: true, replaceReason: "Marked by author" } })}>Mark for replacement</button>}
                  <button type="button" className="btn btn-sm" onClick={() => set({ image: undefined })}>Remove image</button>
                </div>
                {step.image.needsReplacement ? <p className="alert warn" role="status" style={{ marginTop: 8 }}><strong>Needs replacement:</strong> {step.image.replaceReason ?? "flagged"}. Upload a current screenshot (this clears the flag) or confirm it is still accurate.</p> : null}
              </>
            ) : (
              <label className="btn btn-sm" style={{ cursor: "pointer" }}>{busy ? "Uploading…" : "Add screenshot"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="visually-hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
            )}
          </fieldset>
        ) : null}
        <details><summary>Links ({step.links.length})</summary>
          {step.links.map((l, i) => (
            <div key={i} className="btn-row" style={{ marginBottom: 6 }}>
              <input aria-label={`Link ${i + 1} label`} placeholder="Label" value={l.label} onChange={(e) => set({ links: step.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }, `l${i}`)} />
              <input aria-label={`Link ${i + 1} URL`} placeholder="https://…" value={l.url} onChange={(e) => set({ links: step.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) }, `u${i}`)} />
              <button type="button" className="btn btn-sm" onClick={() => set({ links: step.links.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => set({ links: [...step.links, { label: "", url: "" }] })}>Add link</button>
          <p className="hint muted">Only http, https, mailto and relative links are allowed.</p>
        </details>
      </div>
    </li>
  );
}
