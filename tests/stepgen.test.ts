import { describe, expect, it } from "vitest";
import { generateFromEvents, stepFromEvent, type CapturedEvent } from "@/lib/stepgen";

let n = 0;
const ev = (o: Partial<CapturedEvent> & { type: CapturedEvent["type"] }): CapturedEvent => ({
  id: `e${++n}`, seq: n, at: new Date(1_700_000_000_000 + n * 5000).toISOString(), url: "https://expenses.contoso.example/claims", pageTitle: "Claims - Contoso Expenses",
  target: {}, viewport: { width: 1000, height: 600 }, rect: { x: 100, y: 200, w: 120, h: 40 }, ...o,
});

describe("step generation from captured activity", () => {
  it("creates action-oriented numbered steps and never includes typed values", () => {
    n = 0;
    const g = generateFromEvents([
      ev({ type: "navigate" }),
      ev({ type: "click", target: { tag: "button", role: "button", name: "New claim", selectorHint: "button#new" } }),
      ev({ type: "click", target: { tag: "input", label: "Description", selectorHint: "input#desc" } }),
      ev({ type: "change", target: { tag: "input", inputType: "text", label: "Description", selectorHint: "input#desc", valueLength: 14 } }),
      ev({ type: "change", target: { tag: "select", name: "Category", optionLabel: "Travel", selectorHint: "select#cat" } }),
      ev({ type: "click", target: { tag: "button", role: "button", name: "Submit claim", selectorHint: "button#submit" } }),
    ]);
    const texts = g.content.steps.map((s) => s.text);
    expect(texts).toEqual([
      "Go to **Claims - Contoso Expenses** (expenses.contoso.example).",
      "Click **New claim**.",
      "Enter the required value in the **Description** field.",
      "Choose **Travel** from the **Category** list.",
      "Click **Submit claim**.",
    ]);
    expect(g.dropped.map((d) => d.reason)).toEqual(["click into a field that is then filled (merged into the entry step)"]);
    expect(g.application).toEqual({ name: "Contoso Expenses", host: "expenses.contoso.example" });
    expect(g.content.title).toBe("Submit claim in Contoso Expenses");
    expect(g.content.steps.every((s) => s.origin.type === "capture" && s.origin.eventId)).toBe(true);
  });

  it("drops duplicates, loading screens, unnamed generic clicks and merges navigation consequences", () => {
    n = 0;
    const g = generateFromEvents([
      ev({ type: "click", target: { tag: "button", role: "button", name: "Search", selectorHint: "b#s" } }),
      ev({ type: "click", target: { tag: "button", role: "button", name: "Search", selectorHint: "b#s" }, at: new Date(1_700_000_000_000 + 1 * 5000 + 400).toISOString() }),
      ev({ type: "navigate", url: "https://expenses.contoso.example/loading", pageTitle: "Loading…" }),
      ev({ type: "click", target: { tag: "div" } }),
      ev({ type: "navigate", url: "https://expenses.contoso.example/results", pageTitle: "Results - Contoso Expenses", at: new Date(1_700_000_000_000 + 5000 + 1500).toISOString() }),
    ]);
    expect(g.content.steps).toHaveLength(1);
    const reasons = g.dropped.map((d) => d.reason);
    expect(reasons).toEqual(expect.arrayContaining(["duplicate click (double-click)", "loading screen", "click on an unnamed generic area (low value)"]));
  });

  it("flags ambiguous targets, highlights the target area and suggests (does not insert) warnings and validations", () => {
    n = 0;
    const g = generateFromEvents([
      ev({ type: "click", target: { tag: "a", role: "link", name: "", selectorHint: "a.x" }, contentAssetId: "asset1" }),
      ev({ type: "click", target: { tag: "button", role: "button", name: "Delete claim", selectorHint: "b#d" }, contentAssetId: "asset2" }),
    ]);
    expect(g.content.steps[0].origin.flags.some((f) => f.code === "ambiguous")).toBe(true);
    const ann = g.content.steps[1].image!.annotations[0];
    expect(ann.kind).toBe("box");
    expect(ann.x).toBeCloseTo((100 - 6) / 1000, 3);
    expect(ann.w).toBeCloseTo(132 / 1000, 3);
    expect(g.suggestions.map((s) => s.kind)).toContain("warning");
    expect(g.content.steps.some((s) => s.kind === "warning")).toBe(false); // suggestions are not auto-applied
  });

  it("marks sensitive fields and unredacted sensitive pages", () => {
    n = 0;
    const s = stepFromEvent(ev({ type: "change", target: { tag: "input", inputType: "password", label: "Password" } }));
    expect(s.text).toContain("never recorded");
    expect(s.origin.flags.some((f) => f.code === "sensitive-content")).toBe(true);
    const s2 = stepFromEvent(ev({ type: "click", target: { tag: "button", role: "button", name: "Next" }, sensitiveHits: 3, redactions: [] }));
    expect(s2.origin.flags.some((f) => f.code === "sensitive-content")).toBe(true);
    const s3 = stepFromEvent(ev({ type: "click", target: { tag: "button", role: "button", name: "Next" }, sensitiveHits: 3, redactions: [{}] }));
    expect(s3.origin.flags.some((f) => f.code === "sensitive-content")).toBe(false);
  });
});
