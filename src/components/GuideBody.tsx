// Read-only rendering of a guide's structured content. Pure React (no dangerouslySetInnerHTML): all text is escaped.
import React from "react";
import { GuideContent, Step, STEP_KIND_LABELS, isSafeUrl, numberSteps, parseInline } from "@/lib/guide-schema";

export function Inline({ text }: { text: string }) {
  return <>{parseInline(text).map((p, i) => (p.t === "bold" ? <strong key={i}>{p.v}</strong> : p.t === "code" ? <code key={i}>{p.v}</code> : <React.Fragment key={i}>{p.v}</React.Fragment>))}</>;
}

const listSection = (title: string, items: string[]) =>
  items.length ? (
    <section aria-label={title}>
      <h2>{title}</h2>
      <ul>{items.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ul>
    </section>
  ) : null;

export function StepView({ step, number, imageFor, showFlags }: { step: Step; number: string; imageFor: (s: Step) => React.ReactNode; showFlags?: boolean }) {
  const kindLabel = STEP_KIND_LABELS[step.kind];
  const numbered = !!number;
  return (
    <li id={`step-${step.id}`} className={`step kind-${step.kind}`}>
      <h3>
        {numbered ? <span className="num" aria-label={`Step ${number}`}>{number}</span> : null}
        <span>
          {!numbered || step.kind !== "action" ? <span className="badge neutral" style={{ marginRight: 6 }}>{kindLabel}</span> : null}
          {step.title ? <Inline text={step.title} /> : null}
        </span>
      </h3>
      {step.decision ? <p><strong>{step.decision.question}</strong></p> : null}
      {step.exception ? <p><em>When: {step.exception.condition}</em></p> : null}
      {step.physical && (step.physical.location || step.physical.equipment) ? (
        <p className="muted">{step.physical.location ? <>Location: {step.physical.location}. </> : null}{step.physical.equipment ? <>Equipment: {step.physical.equipment}.</> : null}</p>
      ) : null}
      {step.text ? <p style={{ whiteSpace: "pre-wrap" }}><Inline text={step.text} /></p> : null}
      {step.blockRef ? <div className="alert warn"><strong>{step.blockRef.title}.</strong> {step.blockRef.body}</div> : null}
      {imageFor(step)}
      {step.links.filter((l) => isSafeUrl(l.url)).length ? (
        <p>{step.links.filter((l) => isSafeUrl(l.url)).map((l, i) => <a key={i} href={l.url} rel="noopener noreferrer" target={l.url.startsWith("/") ? undefined : "_blank"} style={{ marginRight: 12 }}>{l.label}</a>)}</p>
      ) : null}
      {showFlags && step.origin.flags.length ? <ul className="flag">{step.origin.flags.map((f, i) => <li key={i}><span className="badge warn">{f.code}</span> {f.message}</li>)}</ul> : null}
      {step.decision ? step.decision.branches.map((b) => (
        <div className="branch" key={b.id}>
          <p><strong>If: {b.label}</strong></p>
          <ol className="steps">{numberSteps(b.steps).filter((n) => n.depth === 0).map((n) => <StepView key={n.step.id} step={n.step} number={n.number} imageFor={imageFor} showFlags={showFlags} />)}</ol>
        </div>
      )) : null}
      <p className="no-print" style={{ margin: 0 }}><a className="flag" href={`#step-${step.id}`}>Link to this step</a></p>
    </li>
  );
}

export function GuideBody({ content, imageFor, showFlags }: { content: GuideContent; imageFor: (s: Step) => React.ReactNode; showFlags?: boolean }) {
  const numbered = numberSteps(content.steps).filter((n) => n.depth === 0);
  return (
    <div className="guide">
      {content.purpose ? <section><h2>Purpose</h2><p><Inline text={content.purpose} /></p></section> : null}
      {content.scope ? <section><h2>Scope</h2><p><Inline text={content.scope} /></p></section> : null}
      {content.audience ? <section><h2>Audience</h2><p>{content.audience}</p></section> : null}
      {content.responsibilities.length ? <section><h2>Responsibilities</h2><table className="table"><thead><tr><th>Role</th><th>Responsibility</th></tr></thead><tbody>{content.responsibilities.map((r, i) => <tr key={i}><td>{r.role}</td><td>{r.responsibility}</td></tr>)}</tbody></table></section> : null}
      {listSection("Prerequisites", content.prerequisites)}
      {listSection("Required permissions", content.permissions)}
      {listSection("Hazards", content.hazards)}
      {listSection("PPE", content.ppe)}
      {listSection("Equipment", content.equipment)}
      {listSection("Required training", content.training)}
      {listSection("Quality requirements", content.qualityRequirements)}
      {listSection("Regulatory requirements", content.regulatory)}
      {listSection("Policy requirements", content.policies)}
      <section aria-label="Procedure">
        <h2>Procedure</h2>
        <ol className="steps">{numbered.map((n) => <StepView key={n.step.id} step={n.step} number={n.number} imageFor={imageFor} showFlags={showFlags} />)}</ol>
      </section>
      {content.expectedResult ? <section><h2>Expected result</h2><p><Inline text={content.expectedResult} /></p></section> : null}
      {listSection("Validation checks", content.validationChecks)}
      {content.troubleshooting.length ? <section><h2>Troubleshooting</h2><table className="table"><thead><tr><th>Problem</th><th>What to do</th></tr></thead><tbody>{content.troubleshooting.map((t, i) => <tr key={i}><td>{t.problem}</td><td>{t.resolution}</td></tr>)}</tbody></table></section> : null}
      {content.related.length ? <section><h2>Related procedures</h2><ul>{content.related.map((r, i) => <li key={i}>{r.documentId ? <a href={`/g/${r.documentId}`}>{r.title || r.documentId}</a> : r.url && isSafeUrl(r.url) ? <a href={r.url}>{r.title}</a> : r.title}</li>)}</ul></section> : null}
      {content.acronyms.length ? <section><h2>Definitions and acronyms</h2><dl>{content.acronyms.map((a, i) => <React.Fragment key={i}><dt><strong>{a.term}</strong></dt><dd>{a.expansion}</dd></React.Fragment>)}</dl></section> : null}
    </div>
  );
}
