// Deterministic step/section comparison. Used for version compare, "recording vs existing guide",
// legacy old-vs-new views and export reconciliation. No AI involved.
import { GuideContent, Step, flattenSteps, stepPlainText } from "./guide-schema";

const STOP = new Set(["the", "a", "an", "to", "of", "and", "in", "on", "for", "is", "it", "then", "click", "select", "press", "button", "field", "your", "you", "this", "that"]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\*\*|`/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 && B.size === 0) return a.trim() === b.trim() ? 1 : 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type DiffStatus = "unchanged" | "changed" | "added" | "removed" | "moved";
export interface StepDiff {
  status: DiffStatus;
  similarity: number;
  left?: { id: string; index: number; text: string };
  right?: { id: string; index: number; text: string };
  changes: string[];
}

export interface ContentDiff {
  sections: { key: string; status: "unchanged" | "changed"; left: string; right: string }[];
  steps: StepDiff[];
  summary: { unchanged: number; changed: number; added: number; removed: number; moved: number };
}

const SECTION_KEYS: (keyof GuideContent)[] = ["title", "purpose", "scope", "audience", "expectedResult"];

function listText(v: unknown): string {
  return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n") : String(v ?? "");
}

export function compareContent(left: GuideContent, right: GuideContent, matchThreshold = 0.5): ContentDiff {
  const sections = [
    ...SECTION_KEYS,
    "prerequisites",
    "permissions",
    "equipment",
    "ppe",
    "hazards",
    "validationChecks",
  ].map((k) => {
    const l = listText(left[k as keyof GuideContent]);
    const r = listText(right[k as keyof GuideContent]);
    return { key: k as string, status: (l.trim() === r.trim() ? "unchanged" : "changed") as "unchanged" | "changed", left: l, right: r };
  });

  const L = flattenSteps(left.steps);
  const R = flattenSteps(right.steps);
  const usedR = new Set<number>();
  const pairs: { li: number; ri: number; sim: number }[] = [];

  // Pass 1: exact id match (versions derived from each other keep ids)
  L.forEach((ls, li) => {
    const ri = R.findIndex((rs, i) => !usedR.has(i) && rs.id === ls.id);
    if (ri >= 0) {
      usedR.add(ri);
      pairs.push({ li, ri, sim: similarity(stepPlainText(ls), stepPlainText(R[ri])) });
    }
  });
  const matchedL = new Set(pairs.map((p) => p.li));
  // Pass 2: best text similarity for the rest, ordered by descending similarity
  const cands: { li: number; ri: number; sim: number }[] = [];
  L.forEach((ls, li) => {
    if (matchedL.has(li)) return;
    R.forEach((rs, ri) => {
      if (usedR.has(ri)) return;
      if (ls.kind !== rs.kind && !(ls.kind === "action" && rs.kind === "action")) {
        // different kinds can still match if text is near-identical
      }
      const sim = similarity(stepPlainText(ls), stepPlainText(rs));
      if (sim >= matchThreshold) cands.push({ li, ri, sim });
    });
  });
  cands.sort((a, b) => b.sim - a.sim);
  for (const c of cands) {
    if (matchedL.has(c.li) || usedR.has(c.ri)) continue;
    matchedL.add(c.li);
    usedR.add(c.ri);
    pairs.push(c);
  }

  const diffs: StepDiff[] = [];
  const ref = (s: Step, index: number) => ({ id: s.id, index, text: stepPlainText(s) });
  // Determine "moved" by checking relative order of matched pairs
  const ordered = pairs.slice().sort((a, b) => a.li - b.li);
  let lastRi = -1;
  const movedPairs = new Set<number>();
  for (const p of ordered) {
    if (p.ri < lastRi) movedPairs.add(p.li);
    else lastRi = p.ri;
  }
  for (const p of ordered) {
    const ls = L[p.li];
    const rs = R[p.ri];
    const changes: string[] = [];
    if (ls.title.trim() !== rs.title.trim()) changes.push("title");
    if (ls.text.trim() !== rs.text.trim()) changes.push("text");
    if (ls.kind !== rs.kind) changes.push("kind");
    if ((ls.image?.assetId ?? "") !== (rs.image?.assetId ?? "")) changes.push("screenshot");
    const status: DiffStatus = changes.length ? "changed" : movedPairs.has(p.li) ? "moved" : "unchanged";
    diffs.push({ status, similarity: p.sim, left: ref(ls, p.li), right: ref(rs, p.ri), changes });
  }
  L.forEach((s, li) => {
    if (!matchedL.has(li)) diffs.push({ status: "removed", similarity: 0, left: ref(s, li), changes: [] });
  });
  R.forEach((s, ri) => {
    if (!usedR.has(ri)) diffs.push({ status: "added", similarity: 0, right: ref(s, ri), changes: [] });
  });
  diffs.sort((a, b) => (a.right?.index ?? a.left!.index + 0.5) - (b.right?.index ?? b.left!.index + 0.5));

  const summary = { unchanged: 0, changed: 0, added: 0, removed: 0, moved: 0 };
  for (const d of diffs) summary[d.status]++;
  return { sections, steps: diffs, summary };
}
