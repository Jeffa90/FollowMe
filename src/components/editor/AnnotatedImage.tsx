"use client";
import type { Annotation } from "@/lib/guide-schema";

/** Client-side preview of annotations over the raw image (blur is previewed with a hatched overlay; the server burns it in for readers). */
export function AnnotatedImage({ assetId, annotations, alt, width }: { assetId: string; annotations: Annotation[]; alt: string; width?: number }) {
  return (
    <div className="annot-stage" style={width ? { width } : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/assets/${assetId}`} alt={alt} />
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" style={{ pointerEvents: "none" }}>
        <AnnotationShapes annotations={annotations} />
      </svg>
    </div>
  );
}

export function AnnotationShapes({ annotations, selected }: { annotations: Annotation[]; selected?: string | null }) {
  const S = 1000;
  return (
    <>
      <defs>
        <pattern id="blurhatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#334155" /><line x1="0" y1="0" x2="0" y2="10" stroke="#94a3b8" strokeWidth="4" /></pattern>
      </defs>
      {annotations.map((a) => {
        const x = a.x * S, y = a.y * S, w = (a.w ?? 0) * S, h = (a.h ?? 0) * S;
        const sel = selected === a.id;
        if (a.kind === "box") return <rect key={a.id} x={x} y={y} width={w} height={h} rx={4} fill="none" stroke="#e11d48" strokeWidth={sel ? 6 : 4} vectorEffect="non-scaling-stroke" />;
        if (a.kind === "highlight") return <rect key={a.id} x={x} y={y} width={w} height={h} fill="#facc15" fillOpacity={0.4} stroke={sel ? "#111" : "none"} vectorEffect="non-scaling-stroke" />;
        if (a.kind === "blur") return <rect key={a.id} x={x} y={y} width={w} height={h} fill="url(#blurhatch)" fillOpacity={0.9} stroke={sel ? "#fff" : "none"} />;
        if (a.kind === "arrow") {
          const x2 = (a.x2 ?? a.x) * S, y2 = (a.y2 ?? a.y) * S;
          const ang = Math.atan2(y2 - y, x2 - x), L = 22;
          const p1 = `${x2 - L * Math.cos(ang - 0.45)},${y2 - L * Math.sin(ang - 0.45)}`, p2 = `${x2 - L * Math.cos(ang + 0.45)},${y2 - L * Math.sin(ang + 0.45)}`;
          return <g key={a.id}><line x1={x} y1={y} x2={x2} y2={y2} stroke="#e11d48" strokeWidth={sel ? 7 : 5} strokeLinecap="round" vectorEffect="non-scaling-stroke" /><polygon points={`${x2},${y2} ${p1} ${p2}`} fill="#e11d48" /></g>;
        }
        return <g key={a.id}><circle cx={x} cy={y} r={20} fill="#2563eb" stroke="#fff" strokeWidth={3} /><text x={x} y={y + 7} textAnchor="middle" fontSize={22} fontWeight={700} fill="#fff">{a.n ?? 1}</text></g>;
      })}
    </>
  );
}
