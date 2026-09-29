"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GuideContent, Step, StepKind, findStep } from "@/lib/guide-schema";
import { History } from "@/lib/step-ops";
import type { TemplateDef, TemplateSection } from "@/lib/templates";
import { api, ApiError } from "../api";
import { StepList, type Block, type StepCtx } from "./StepList";
import { AnnotationDialog } from "./AnnotationDialog";
import { AnnotatedImage } from "./AnnotatedImage";
import { GuideBody } from "../GuideBody";
import { SeverityBadge } from "../ui";

type Finding = { id: string; ruleId: string; effectiveSeverity: string; message: string; explanation: string; stepId: string };
type Suggestion = { id: string; kind: string; stepId: string | null; provider: string; payload: Record<string, unknown>; status: string; uncertainty: Record<string, unknown> };
type Mode = "edit" | "desktop" | "mobile" | "print";

const LIST_FIELDS: Partial<Record<TemplateSection["key"], keyof GuideContent>> = {
  prerequisites: "prerequisites", permissions: "permissions", equipment: "equipment", ppe: "ppe", hazards: "hazards", training: "training",
  qualityRequirements: "qualityRequirements", regulatory: "regulatory", policies: "policies", validationChecks: "validationChecks",
};

export function Editor(props: {
  guideId: string; versionId: string; documentId: string; label: string; status: string; initial: GuideContent; rev: number;
  template: TemplateDef; blocks: Block[]; suggestions: Suggestion[]; readOnly: boolean;
}) {
  const [content, setContent] = useState<GuideContent>(props.initial);
  const [rev, setRev] = useState(props.rev);
  const [save, setSave] = useState<"saved" | "saving" | "dirty" | "conflict" | "error">("saved");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [mode, setMode] = useState<Mode>("edit");
  const [selected, setSelected] = useState<string | null>(null);
  const [annotFor, setAnnotFor] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [assessment, setAssessment] = useState<string>("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>(props.suggestions);
  const [toast, setToast] = useState("");
  const hist = useRef(new History<GuideContent>(props.initial));
  const [, force] = useState(0);
  const lastKey = useRef<{ key: string; t: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revRef = useRef(rev);
  const dirty = useRef(false);
  const saving = useRef(false);
  revRef.current = rev;

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 4000); }, []);

  const doSave = useCallback(async () => {
    if (saving.current) { timer.current = setTimeout(doSave, 500); return; }
    saving.current = true;
    setSave("saving");
    const snapshot = hist.current.value;
    try {
      const r = await api(`/api/versions/${props.versionId}/content`, { method: "PUT", body: { content: snapshot, rev: revRef.current } });
      setRev(r.rev); revRef.current = r.rev; setSavedAt(new Date());
      if (hist.current.value === snapshot) { dirty.current = false; setSave("saved"); } else { setSave("dirty"); timer.current = setTimeout(doSave, 300); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setSave("conflict"); else { setSave("error"); flash(e instanceof ApiError ? e.message : "Autosave failed"); }
    } finally { saving.current = false; }
  }, [props.versionId, flash]);

  const schedule = useCallback(() => {
    dirty.current = true; setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(doSave, 1200);
  }, [doSave]);

  const commit = useCallback((next: GuideContent, key?: string) => {
    if (props.readOnly) return;
    const now = Date.now();
    if (key && lastKey.current?.key === key && now - lastKey.current.t < 1500) hist.current.replace(next); else hist.current.push(next);
    lastKey.current = key ? { key, t: now } : null;
    setContent(next); schedule(); force((n) => n + 1);
  }, [schedule, props.readOnly]);

  const undo = () => { setContent(hist.current.undo()); schedule(); force((n) => n + 1); };
  const redo = () => { setContent(hist.current.redo()); schedule(); force((n) => n + 1); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey && !(e.target as HTMLElement).closest("input,textarea")) { e.preventDefault(); undo(); }
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) && !(e.target as HTMLElement).closest("input,textarea")) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("beforeunload", warn); };
  });

  const patch = (p: Partial<GuideContent>, key?: string) => commit({ ...content, ...p }, key ? `f:${key}` : undefined);

  async function runHealth() {
    try { const r = await api(`/api/versions/${props.versionId}/health`); setFindings(r.findings); setAssessment(r.assessment.summary); } catch (e) { flash(e instanceof ApiError ? e.message : "Health check failed"); }
  }
  useEffect(() => { void runHealth(); /* eslint-disable-next-line */ }, []);

  async function decide(id: string, decision: "ACCEPTED" | "REJECTED") {
    try {
      await api(`/api/suggestions/${id}`, { body: { decision } });
      if (decision === "ACCEPTED") { // reload latest content so the accepted change (applied server-side) is reflected
        const v = await api(`/api/versions/${props.versionId}`);
        hist.current = new History<GuideContent>(v.content); setContent(v.content); setRev(v.rev); revRef.current = v.rev; force((n) => n + 1);
      }
      setSuggestions((s) => s.map((x) => (x.id === id ? { ...x, status: decision } : x)));
      flash(decision === "ACCEPTED" ? "Suggestion accepted into the draft" : "Suggestion rejected");
      void runHealth();
    } catch (e) { flash(e instanceof ApiError ? e.message : "Failed"); }
  }

  const [aiBusy, setAiBusy] = useState("");
  async function runTask(task: string) {
    setAiBusy(task);
    try {
      const r = await api(`/api/versions/${props.versionId}/ai`, { body: { task, stepId: selected ?? undefined } });
      setSuggestions((s) => [...s, ...r.suggestions]);
      flash(r.suggestions.length ? `${r.suggestions.length} suggestion(s) added below. Nothing has been changed in your draft.` : r.note ?? "Nothing to suggest.");
    } catch (e) { flash(e instanceof ApiError ? e.message : "Failed"); } finally { setAiBusy(""); }
  }
  const stepCtx: StepCtx = useMemo(() => ({
    guideId: props.guideId, versionId: props.versionId, blocks: props.blocks, allowedKinds: props.template.stepKinds as StepKind[],
    openAnnotate: setAnnotFor, selectedId: selected, setSelected, flash,
  }), [props.guideId, props.versionId, props.blocks, props.template.stepKinds, selected, flash]);

  const annotStep = annotFor ? findStep(content.steps, annotFor) : undefined;
  const sections = props.template.sections.filter((s) => s.enabled);
  const sectionOn = (k: TemplateSection["key"]) => sections.find((s) => s.key === k);
  const Text = ({ k, label, rows }: { k: "purpose" | "scope" | "audience" | "expectedResult"; label: string; rows?: number }) => {
    const sec = sectionOn(k);
    if (!sec) return null;
    return <label className="field">{sec.label}{sec.required ? " *" : ""} {sec.hint ? <span className="hint">{sec.hint}</span> : null}<textarea rows={rows ?? 3} value={content[k]} onChange={(e) => patch({ [k]: e.target.value }, k)}/></label>;
  };
  const ListF = ({ k }: { k: TemplateSection["key"] }) => {
    const sec = sectionOn(k); const field = LIST_FIELDS[k];
    if (!sec || !field) return null;
    const val = (content[field] as string[]).join("\n");
    return <label className="field">{sec.label}{sec.required ? " *" : ""} <span className="hint">One item per line.</span><textarea rows={3} value={val} onChange={(e) => patch({ [field]: e.target.value.split("\n") } as Partial<GuideContent>, k)} onBlur={() => patch({ [field]: (content[field] as string[]).map((x) => x.trim()).filter(Boolean) } as Partial<GuideContent>)} /></label>;
  };

  const saveLabel = save === "saved" ? `Saved${savedAt ? " at " + savedAt.toLocaleTimeString() : ""}` : save === "saving" ? "Saving…" : save === "dirty" ? "Unsaved changes" : save === "conflict" ? "Conflict: changed elsewhere" : "Save failed";
  const pending = suggestions.filter((s) => s.status === "PENDING");

  const preview = (
    <div className={`preview-frame ${mode === "mobile" ? "mobile" : mode === "print" ? "print" : "desktop"}`} aria-label={`${mode} preview`}>
      <h1>{content.title || "Untitled"}</h1>
      <GuideBody content={content} showFlags imageFor={(s: Step) => (s.image ? <AnnotatedImage assetId={s.image.assetId} annotations={s.image.annotations} alt={s.image.alt} /> : null)} />
    </div>
  );

  return (
    <div>
      <div className="card no-print" style={{ position: "sticky", top: 60, zIndex: 10, padding: "8px 12px" }}>
        <div className="btn-row" style={{ justifyContent: "space-between" }}>
          <div><strong>{props.documentId} v{props.label}</strong> <span className="badge neutral">{props.status.replaceAll("_", " ").toLowerCase()}</span> {props.readOnly ? <span className="badge warn">Read-only</span> : null}</div>
          <div className="btn-row">
            <button type="button" className="btn btn-sm" onClick={undo} disabled={!hist.current.canUndo || props.readOnly} aria-keyshortcuts="Control+Z">Undo</button>
            <button type="button" className="btn btn-sm" onClick={redo} disabled={!hist.current.canRedo || props.readOnly} aria-keyshortcuts="Control+Y">Redo</button>
            <span className="saving muted" role="status" aria-live="polite" data-testid="save-status">{saveLabel}</span>
            {save === "conflict" ? <button className="btn btn-sm btn-danger" onClick={() => window.location.reload()}>Reload latest</button> : null}
            <div role="group" aria-label="View mode" className="btn-row">
              {(["edit", "desktop", "mobile", "print"] as Mode[]).map((m) => <button key={m} type="button" className={`btn btn-sm ${mode === m ? "btn-primary" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === "edit" ? "Edit" : `Preview: ${m}`}</button>)}
            </div>
            {mode === "print" ? <button className="btn btn-sm" onClick={() => window.print()}>Print</button> : null}
            <Link className="btn btn-sm" href={`/guides/${props.guideId}`}>Governance &amp; submit</Link>
          </div>
        </div>
        {toast ? <p role="status" className="alert info" style={{ margin: "8px 0 0" }}>{toast}</p> : null}
        {save === "conflict" ? <p role="alert" className="alert danger" style={{ margin: "8px 0 0" }}>Someone else saved this draft after you opened it. Your unsaved edits are not applied; reload to see the latest.</p> : null}
      </div>

      {mode !== "edit" ? <div style={{ marginTop: 16 }}>{preview}</div> : (
        <div className="editor" style={{ marginTop: 16 }}>
          <div>
            <fieldset disabled={props.readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
              <section className="card" aria-labelledby="ed-details"><h2 id="ed-details">Details</h2>
                <label className="field">Title *<input value={content.title} onChange={(e) => patch({ title: e.target.value }, "title")} /></label>
                <Text k="purpose" label="Purpose" /><Text k="scope" label="Scope" /><Text k="audience" label="Audience" rows={2} />
                {sectionOn("responsibilities") ? (
                  <fieldset><legend>{sectionOn("responsibilities")!.label}{sectionOn("responsibilities")!.required ? " *" : ""}</legend>
                    {content.responsibilities.map((r, i) => (
                      <div key={i} className="btn-row" style={{ marginBottom: 6 }}>
                        <input aria-label={`Role ${i + 1}`} placeholder="Role" value={r.role} onChange={(e) => patch({ responsibilities: content.responsibilities.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) }, `r${i}`)} />
                        <input aria-label={`Responsibility ${i + 1}`} style={{ flex: 1 }} placeholder="Responsibility" value={r.responsibility} onChange={(e) => patch({ responsibilities: content.responsibilities.map((x, j) => (j === i ? { ...x, responsibility: e.target.value } : x)) }, `rr${i}`)} />
                        <button type="button" className="btn btn-sm" onClick={() => patch({ responsibilities: content.responsibilities.filter((_, j) => j !== i) })}>Remove</button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-sm" onClick={() => patch({ responsibilities: [...content.responsibilities, { role: "", responsibility: "" }] })}>Add responsibility</button>
                  </fieldset>
                ) : null}
                {(["prerequisites", "permissions", "equipment", "ppe", "hazards", "training", "qualityRequirements", "regulatory", "policies"] as const).map((k) => <ListF key={k} k={k} />)}
              </section>

              <section className="card" style={{ marginTop: 16 }} aria-labelledby="ed-steps"><h2 id="ed-steps">Procedure</h2>
                <StepList steps={content.steps} ctx={stepCtx} onChange={(steps, key) => commit({ ...content, steps }, key)} />
              </section>

              <section className="card" style={{ marginTop: 16 }} aria-labelledby="ed-after"><h2 id="ed-after">Result, checks and support</h2>
                <Text k="expectedResult" label="Expected result" />
                <ListF k="validationChecks" />
                {sectionOn("troubleshooting") ? (
                  <fieldset><legend>{sectionOn("troubleshooting")!.label}</legend>
                    {content.troubleshooting.map((t, i) => (
                      <div key={i} className="btn-row" style={{ marginBottom: 6 }}>
                        <input aria-label={`Problem ${i + 1}`} placeholder="Problem" value={t.problem} onChange={(e) => patch({ troubleshooting: content.troubleshooting.map((x, j) => (j === i ? { ...x, problem: e.target.value } : x)) }, `tp${i}`)} />
                        <input aria-label={`Resolution ${i + 1}`} style={{ flex: 1 }} placeholder="What to do" value={t.resolution} onChange={(e) => patch({ troubleshooting: content.troubleshooting.map((x, j) => (j === i ? { ...x, resolution: e.target.value } : x)) }, `tr${i}`)} />
                        <button type="button" className="btn btn-sm" onClick={() => patch({ troubleshooting: content.troubleshooting.filter((_, j) => j !== i) })}>Remove</button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-sm" onClick={() => patch({ troubleshooting: [...content.troubleshooting, { problem: "", resolution: "" }] })}>Add troubleshooting item</button>
                  </fieldset>
                ) : null}
                {sectionOn("related") ? (
                  <fieldset><legend>{sectionOn("related")!.label}</legend>
                    {content.related.map((r, i) => (
                      <div key={i} className="btn-row" style={{ marginBottom: 6 }}>
                        <input aria-label={`Related guide ${i + 1} document ID`} placeholder="WI-0001" value={r.documentId ?? ""} onChange={(e) => patch({ related: content.related.map((x, j) => (j === i ? { ...x, documentId: e.target.value || undefined } : x)) }, `rd${i}`)} />
                        <input aria-label={`Related item ${i + 1} title`} placeholder="Title" value={r.title} onChange={(e) => patch({ related: content.related.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) }, `rt${i}`)} />
                        <button type="button" className="btn btn-sm" onClick={() => patch({ related: content.related.filter((_, j) => j !== i) })}>Remove</button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-sm" onClick={() => patch({ related: [...content.related, { title: "" }] })}>Add related procedure</button>
                  </fieldset>
                ) : null}
                {sectionOn("acronyms") ? (
                  <fieldset><legend>{sectionOn("acronyms")!.label}</legend>
                    {content.acronyms.map((a, i) => (
                      <div key={i} className="btn-row" style={{ marginBottom: 6 }}>
                        <input aria-label={`Acronym ${i + 1}`} placeholder="PO" value={a.term} onChange={(e) => patch({ acronyms: content.acronyms.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)) }, `at${i}`)} />
                        <input aria-label={`Expansion ${i + 1}`} style={{ flex: 1 }} placeholder="Purchase order" value={a.expansion} onChange={(e) => patch({ acronyms: content.acronyms.map((x, j) => (j === i ? { ...x, expansion: e.target.value } : x)) }, `ae${i}`)} />
                        <button type="button" className="btn btn-sm" onClick={() => patch({ acronyms: content.acronyms.filter((_, j) => j !== i) })}>Remove</button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-sm" onClick={() => patch({ acronyms: [...content.acronyms, { term: "", expansion: "" }] })}>Add definition</button>
                  </fieldset>
                ) : null}
                {sectionOn("competency") ? (
                  <fieldset><legend>{sectionOn("competency")!.label}</legend>
                    {(["acknowledgementRequired", "quizRequired", "checklistRequired"] as const).map((k) => (
                      <label key={k} className="inline" style={{ display: "flex" }}><input type="checkbox" checked={content.competency[k]} onChange={(e) => patch({ competency: { ...content.competency, [k]: e.target.checked } })} /> {{ acknowledgementRequired: "Require acknowledgement", quizRequired: "Require knowledge quiz", checklistRequired: "Require practical competency checklist (trainer/supervisor sign-off)" }[k]}</label>
                    ))}
                    <label className="field">Practical checklist <span className="hint">One item per line.</span><textarea rows={3} value={content.competency.checklist.join("\n")} onChange={(e) => patch({ competency: { ...content.competency, checklist: e.target.value.split("\n") } }, "chk")} /></label>
                  </fieldset>
                ) : null}
              </section>
            </fieldset>
          </div>

          <aside className="panel" aria-label="Editor side panel">
            <section className="card" aria-labelledby="pn-out"><h2 id="pn-out">Outline</h2>
              <ol style={{ paddingLeft: 18, margin: 0 }}>{content.steps.map((s) => <li key={s.id}><a href={`#edit-${s.id}`} onClick={() => setSelected(s.id)}>{s.title || s.text.slice(0, 40) || s.kind}</a></li>)}</ol>
            </section>
            <section className="card" style={{ marginTop: 12 }} aria-labelledby="pn-sug"><h2 id="pn-sug">Suggestions ({pending.length})</h2>
              <p className="muted" style={{ marginTop: 0 }}>Suggestions come from FollowMe rules or AI. They are <strong>not</strong> part of the guide until you accept them.</p>
              <div className="btn-row" role="group" aria-label="Generate suggestions" style={{ marginBottom: 8 }}>
                {([["suggest_missing", "Suggest missing checks"], ["terms", "Check terms & acronyms"], ["mismatch", "Check screenshots vs text"], ["rewrite_step", "Tighten selected step"], ["quiz", "Draft knowledge check"], ["faq", "FAQs"], ["summary", "Summarise"]] as const).map(([t, l]) => (
                  <button key={t} type="button" className="btn btn-sm" disabled={!!aiBusy || props.readOnly || (t === "rewrite_step" && !selected)} onClick={() => runTask(t)}>{aiBusy === t ? "Working…" : l}</button>
                ))}
              </div>
              {pending.length === 0 ? <p className="muted">None pending.</p> : pending.map((s) => (
                <div key={s.id} className="alert info">
                  <strong>{s.kind}</strong> <span className="badge neutral">{s.provider === "rules" ? "rules (not AI)" : `AI: ${s.provider}`}</span>
                  <p style={{ margin: "4px 0" }}>{String(s.payload.text ?? s.payload.title ?? JSON.stringify(s.payload))}</p>
                  {s.uncertainty?.reason ? <p className="muted" style={{ margin: 0 }}>Why: {String(s.uncertainty.reason)}</p> : null}
                  <div className="btn-row" style={{ marginTop: 6 }}>
                    {["warning", "validation", "note", "rewrite", "prerequisite", "acronym", "quiz"].includes(s.kind) ? <button className="btn btn-sm btn-primary" disabled={props.readOnly} onClick={() => decide(s.id, "ACCEPTED")}>Accept into draft</button> : <span className="muted">Informational</span>}
                    <button className="btn btn-sm" onClick={() => decide(s.id, "REJECTED")}>{["warning", "validation", "note", "rewrite", "prerequisite", "acronym", "quiz"].includes(s.kind) ? "Reject" : "Dismiss"}</button>
                  </div>
                </div>
              ))}
            </section>
            <section className="card" style={{ marginTop: 12 }} aria-labelledby="pn-health"><h2 id="pn-health">Quality checks</h2>
              <button className="btn btn-sm" onClick={runHealth}>Re-check now</button>
              {assessment ? <p role="status">{assessment}</p> : null}
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                {(findings ?? []).map((f) => (
                  <li key={f.id}><SeverityBadge severity={f.effectiveSeverity} /> {f.message}{" "}
                    {f.stepId ? <a href={`#edit-${f.stepId}`} onClick={() => setSelected(f.stepId)}>Go to step</a> : null}
                    <details><summary className="muted">Why?</summary><span className="muted">{f.explanation}</span></details>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      )}

      {annotStep?.image ? (
        <AnnotationDialog key={annotStep.id} image={annotStep.image} guideId={props.guideId} onClose={() => setAnnotFor(null)}
          onSave={(img) => commit({ ...content, steps: replaceStepImage(content.steps, annotStep.id, img) })} />
      ) : null}
    </div>
  );
}

function replaceStepImage(steps: Step[], id: string, image: Step["image"]): Step[] {
  return steps.map((s) => (s.id === id ? { ...s, image } : s.decision ? { ...s, decision: { ...s.decision, branches: s.decision.branches.map((b) => ({ ...b, steps: replaceStepImage(b.steps, id, image) })) } } : s));
}
