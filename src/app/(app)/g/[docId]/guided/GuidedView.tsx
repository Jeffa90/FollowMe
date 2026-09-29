"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Step } from "@/lib/guide-schema";
import { Inline } from "@/components/GuideBody";

export function GuidedView({ documentId, versionId, title, versionLabel, steps }: { documentId: string; versionId: string; title: string; versionLabel: string; steps: { step: Step; number: string; depth: number }[] }) {
  const [i, setI] = useState(0);
  // Deep links to a step (#step-<id>) can only be read on the client after hydration.
  useEffect(() => {
    const fromHash = steps.findIndex((s) => `#step-${s.step.id}` === window.location.hash);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromHash >= 0) setI(fromHash);
  }, [steps]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      if (e.key === "ArrowRight") setI((x) => Math.min(steps.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length]);
  const cur = steps[i];
  if (!cur) return <p>This guide has no steps.</p>;
  const s = cur.step;
  return (
    <div className="guide">
      <p className="muted">{documentId} · v{versionLabel} · <Link href={`/g/${documentId}`}>Full guide</Link></p>
      <h1>{title}</h1>
      <p aria-live="polite" role="status"><strong>Step {i + 1} of {steps.length}</strong></p>
      <progress value={i + 1} max={steps.length} aria-label="Progress" style={{ width: "100%" }} />
      <section className={`step kind-${s.kind}`} aria-label={`Step ${i + 1}`} style={{ marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>{cur.number ? <span className="num" aria-hidden="true">{cur.number}</span> : null}<Inline text={s.title || s.kind} /></h2>
        {s.decision ? <p><strong>{s.decision.question}</strong> Options: {s.decision.branches.map((b) => b.label).join(" / ")}. Continue to the next step for each path.</p> : null}
        {s.text ? <p style={{ whiteSpace: "pre-wrap", fontSize: "1.15rem" }}><Inline text={s.text} /></p> : null}
        {s.blockRef ? <div className="alert warn"><strong>{s.blockRef.title}.</strong> {s.blockRef.body}</div> : null}
        {s.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img className="shot" src={`/api/versions/${versionId}/steps/${s.id}/image?w=1200`} alt={s.image.alt || ""} /> : null}
      </section>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>← Previous</button>
        <button className="btn btn-primary" onClick={() => setI(Math.min(steps.length - 1, i + 1))} disabled={i === steps.length - 1}>Next →</button>
        <span className="muted">Tip: use the left and right arrow keys.</span>
      </div>
    </div>
  );
}
