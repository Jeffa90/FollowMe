// Pure, immutable step operations used by the visual editor (and unit-tested).
import { Step, StepKind, newId, newStep } from "./guide-schema";

export function insertStep(steps: Step[], index: number, step: Step): Step[] {
  const i = Math.max(0, Math.min(index, steps.length));
  return [...steps.slice(0, i), step, ...steps.slice(i)];
}

export function insertNew(steps: Step[], index: number, kind: StepKind = "action"): { steps: Step[]; id: string } {
  const s = newStep(kind);
  return { steps: insertStep(steps, index, s), id: s.id };
}

function cloneWithNewIds(step: Step): Step {
  const c: Step = JSON.parse(JSON.stringify(step));
  c.id = newId("s");
  if (c.image) c.image.annotations = c.image.annotations.map((a) => ({ ...a, id: newId("a") }));
  if (c.decision) {
    c.decision.branches = c.decision.branches.map((b) => ({ ...b, id: newId("b"), steps: b.steps.map(cloneWithNewIds) }));
  }
  return c;
}

export function duplicateStep(steps: Step[], id: string): { steps: Step[]; id?: string } {
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0) return { steps };
  const c = cloneWithNewIds(steps[i]);
  c.origin = { ...c.origin, type: "manual", sourceBlockIds: undefined, eventId: undefined };
  return { steps: insertStep(steps, i + 1, c), id: c.id };
}

export function deleteStep(steps: Step[], id: string): Step[] {
  return steps.filter((s) => s.id !== id);
}

export function moveStep(steps: Step[], id: string, delta: -1 | 1): Step[] {
  const i = steps.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= steps.length) return steps;
  const next = steps.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function moveStepTo(steps: Step[], id: string, toIndex: number): Step[] {
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0) return steps;
  const next = steps.slice();
  const [item] = next.splice(i, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, item);
  return next;
}

/** Merge step `id` with the following step: text is joined, first image kept, flags combined. */
export function mergeWithNext(steps: Step[], id: string): Step[] {
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0 || i >= steps.length - 1) return steps;
  const a = steps[i];
  const b = steps[i + 1];
  if (a.decision || b.decision) return steps; // decisions are never merged implicitly
  const merged: Step = {
    ...a,
    title: [a.title, b.title].filter(Boolean).join(" and ").trim(),
    text: [a.text, b.text].filter(Boolean).join("\n"),
    image: a.image ?? b.image,
    links: [...a.links, ...b.links],
    origin: {
      ...a.origin,
      sourceBlockIds: [...(a.origin.sourceBlockIds ?? []), ...(b.origin.sourceBlockIds ?? [])],
      flags: [...a.origin.flags, ...b.origin.flags],
    },
  };
  return [...steps.slice(0, i), merged, ...steps.slice(i + 2)];
}

/** Split a step: the text is divided at `at` (character offset) or, if omitted, at the first line break / sentence end. */
export function splitStep(steps: Step[], id: string, at?: number): Step[] {
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0) return steps;
  const s = steps[i];
  const text = s.text;
  let cut = at ?? -1;
  if (cut < 0) {
    const nl = text.indexOf("\n");
    if (nl > 0) cut = nl;
    else {
      const m = /[.!?]\s+/.exec(text);
      cut = m ? m.index + m[0].length : -1;
    }
  }
  if (cut <= 0 || cut >= text.length) return steps;
  const first: Step = { ...s, text: text.slice(0, cut).trim() };
  const second: Step = newStep(s.kind, {
    title: "",
    text: text.slice(cut).trim(),
    origin: { ...s.origin, flags: [], sourceBlockIds: s.origin.sourceBlockIds },
  });
  return [...steps.slice(0, i), first, second, ...steps.slice(i + 1)];
}

export function updateStep(steps: Step[], id: string, patch: Partial<Step>): Step[] {
  return steps.map((s) => {
    if (s.id === id) return { ...s, ...patch };
    if (s.decision) {
      return {
        ...s,
        decision: { ...s.decision, branches: s.decision.branches.map((b) => ({ ...b, steps: updateStep(b.steps, id, patch) })) },
      };
    }
    return s;
  });
}

/** Undo/redo history over immutable snapshots. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private present: T, private limit = 100) {}
  get value(): T {
    return this.present;
  }
  push(next: T): T {
    if (next === this.present) return this.present;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.present = next;
    return next;
  }
  /** Replace the present without adding an undo entry (used to coalesce rapid typing). */
  replace(next: T): T {
    this.present = next;
    return next;
  }
  undo(): T {
    const p = this.past.pop();
    if (p !== undefined) {
      this.future.push(this.present);
      this.present = p;
    }
    return this.present;
  }
  redo(): T {
    const f = this.future.pop();
    if (f !== undefined) {
      this.past.push(this.present);
      this.present = f;
    }
    return this.present;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
}
