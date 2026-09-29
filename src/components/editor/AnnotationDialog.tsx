"use client";
import { useEffect, useRef, useState } from "react";
import { newId, type Annotation, type StepImage } from "@/lib/guide-schema";
import { AnnotationShapes } from "./AnnotatedImage";
import { api } from "../api";

type Tool = "select" | "box" | "highlight" | "blur" | "arrow" | "marker" | "crop";
const TOOLS: { id: Tool; label: string }[] = [
  { id: "select", label: "Select" }, { id: "box", label: "Box" }, { id: "highlight", label: "Highlight" }, { id: "blur", label: "Blur / redact" },
  { id: "arrow", label: "Arrow" }, { id: "marker", label: "Numbered marker" }, { id: "crop", label: "Crop" },
];

/**
 * Screenshot annotation & redaction editor. Drawing works by click-drag OR two clicks (no dragging required, WCAG 2.5.7),
 * and every annotation is also editable with numeric fields (keyboard accessible).
 */
export function AnnotationDialog({ image, guideId, onSave, onClose }: { image: StepImage; guideId: string; onSave: (img: StepImage) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [anns, setAnns] = useState<Annotation[]>(image.annotations);
  const [tool, setTool] = useState<Tool>("box");
  const [sel, setSel] = useState<string | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [assetId, setAssetId] = useState(image.assetId);
  const [err, setErr] = useState("");
  useEffect(() => { ref.current?.showModal(); }, []);

  const pt = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const nextMarker = () => Math.max(0, ...anns.filter((a) => a.kind === "marker").map((a) => a.n ?? 0)) + 1;

  function finish(a: { x: number; y: number }, b: { x: number; y: number }) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    if (tool === "crop") { if (w > 0.02 && h > 0.02) setCropRect({ x, y, w, h }); return; }
    if (tool === "arrow") { if (Math.hypot(a.x - b.x, a.y - b.y) > 0.02) { const id = newId("a"); setAnns((l) => [...l, { id, kind: "arrow", x: a.x, y: a.y, x2: b.x, y2: b.y }]); setSel(id); } return; }
    if (w > 0.01 && h > 0.01) { const id = newId("a"); setAnns((l) => [...l, { id, kind: tool as Annotation["kind"], x, y, w, h }]); setSel(id); }
  }
  function down(e: React.PointerEvent) {
    if (tool === "select") return;
    const p = pt(e);
    if (tool === "marker") { const id = newId("a"); setAnns((l) => [...l, { id, kind: "marker", x: p.x, y: p.y, n: nextMarker() }]); setSel(id); return; }
    if (!start) { setStart(p); setCur(p); } // first click (or drag start)
  }
  function up(e: React.PointerEvent) {
    if (!start) return;
    const p = pt(e);
    if (Math.hypot(p.x - start.x, p.y - start.y) > 0.015) { finish(start, p); setStart(null); setCur(null); } // was a drag
    // otherwise it was a click: remain in "second click" mode
  }
  function click(e: React.MouseEvent) {
    if (!start || tool === "select" || tool === "marker") return;
    const p = pt(e);
    if (Math.hypot(p.x - start.x, p.y - start.y) > 0.015) { finish(start, p); setStart(null); setCur(null); }
  }
  const preview: Annotation | null = start && cur && tool !== "crop" && tool !== "marker" ? (tool === "arrow" ? { id: "p", kind: "arrow", x: start.x, y: start.y, x2: cur.x, y2: cur.y } : { id: "p", kind: tool as Annotation["kind"], x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(start.x - cur.x), h: Math.abs(start.y - cur.y) }) : null;

  const selected = anns.find((a) => a.id === sel);
  const upd = (id: string, patch: Partial<Annotation>) => setAnns((l) => l.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const pctField = (label: string, key: keyof Annotation) => selected && selected[key] !== undefined ? (
    <label className="field" style={{ margin: 0 }}>{label} (%)
      <input type="number" min={0} max={100} step={1} value={Math.round(Number(selected[key]) * 100)} onChange={(e) => upd(selected.id, { [key]: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} />
    </label>
  ) : null;

  async function applyCrop() {
    if (!cropRect) return;
    if (!confirm("Cropping creates a new image and clears annotations (the original is kept as evidence). Continue?")) return;
    try {
      const r = await api(`/api/assets/${assetId}/crop`, { body: { ...cropRect, guideId } });
      setAssetId(r.id); setAnns([]); setCropRect(null); setSel(null); setTool("box");
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="ann-h" style={{ maxWidth: 1100 }}>
      <h2 id="ann-h" style={{ marginTop: 0 }}>Annotate and redact screenshot</h2>
      <div role="toolbar" aria-label="Annotation tools" className="btn-row" style={{ marginBottom: 8 }}>
        {TOOLS.map((t) => <button key={t.id} type="button" className={`btn btn-sm ${tool === t.id ? "btn-primary" : ""}`} aria-pressed={tool === t.id} onClick={() => { setTool(t.id); setStart(null); setCur(null); }}>{t.label}</button>)}
      </div>
      <p className="muted" role="status">
        {tool === "select" ? "Choose an annotation from the list to edit it." : tool === "marker" ? "Click the image to place a numbered marker." : start ? "Click (or release) where the shape should end." : "Drag on the image, or click once to start and click again to finish."}
        {" "}<strong>Blur / redact</strong> is burned into the image readers receive.
      </p>
      <div className="annot-stage" style={{ maxHeight: "55vh", overflow: "auto" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/assets/${assetId}`} alt={image.alt || "Screenshot being annotated"} draggable={false} />
        <svg ref={svgRef} viewBox="0 0 1000 1000" preserveAspectRatio="none" onPointerDown={down} onPointerUp={up} onClick={click} onPointerMove={(e) => start && setCur(pt(e))} role="application" aria-label="Annotation canvas">
          <AnnotationShapes annotations={preview ? [...anns, preview] : anns} selected={sel} />
          {cropRect ? <rect x={cropRect.x * 1000} y={cropRect.y * 1000} width={cropRect.w * 1000} height={cropRect.h * 1000} fill="none" stroke="#2563eb" strokeWidth={4} strokeDasharray="14 8" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
      </div>
      {cropRect ? <div className="btn-row" style={{ marginTop: 8 }}><button type="button" className="btn btn-primary btn-sm" onClick={applyCrop}>Apply crop</button><button type="button" className="btn btn-sm" onClick={() => setCropRect(null)}>Cancel crop</button></div> : null}
      {err ? <p role="alert" className="alert danger">{err}</p> : null}
      <h3>Annotations ({anns.length})</h3>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 4, maxHeight: 130, overflow: "auto" }}>
        {anns.map((a, i) => (
          <li key={a.id} className="btn-row">
            <button type="button" className={`btn btn-sm ${sel === a.id ? "btn-primary" : ""}`} onClick={() => { setSel(a.id); setTool("select"); }}>{i + 1}. {a.kind}{a.kind === "marker" ? ` ${a.n}` : ""}</button>
            <button type="button" className="btn btn-sm" aria-label={`Delete annotation ${i + 1}`} onClick={() => { setAnns((l) => l.filter((x) => x.id !== a.id)); if (sel === a.id) setSel(null); }}>Delete</button>
          </li>
        ))}
      </ul>
      {selected ? <div className="grid cols-3" aria-label="Selected annotation position">{pctField("X", "x")}{pctField("Y", "y")}{pctField("Width", "w")}{pctField("Height", "h")}{pctField("End X", "x2")}{pctField("End Y", "y2")}</div> : null}
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-primary" onClick={() => { onSave({ ...image, assetId, annotations: anns, ...(assetId !== image.assetId ? { sourceAssetId: image.sourceAssetId ?? image.assetId } : {}) }); ref.current?.close(); }}>Save annotations</button>
        <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
      </div>
    </dialog>
  );
}
