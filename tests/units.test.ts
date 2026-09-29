import { describe, expect, it } from "vitest";
import { History, insertNew, duplicateStep, mergeWithNext, splitStep, moveStep, moveStepTo, deleteStep, updateStep } from "@/lib/step-ops";
import { compareContent, similarity } from "@/lib/compare";
import { emptyContent, newStep, numberSteps, parseInline, isSafeUrl, guideContentSchema, flattenSteps, stepPlainText } from "@/lib/guide-schema";
import { hostRestricted } from "@/lib/policy";
import { contentHash } from "@/server/hash";
import { auditHash } from "@/server/audit";

const steps = () => [newStep("action", { title: "One", text: "First." }), newStep("action", { title: "Two", text: "Second sentence. Third sentence." }), newStep("warning", { text: "Careful" }), newStep("action", { title: "Three", text: "Third." })];

describe("step operations (editor)", () => {
  it("insert, duplicate (new ids), delete, move, merge, split, update", () => {
    let s = steps();
    const ins = insertNew(s, 1, "note"); expect(ins.steps).toHaveLength(5); expect(ins.steps[1].kind).toBe("note");
    const dup = duplicateStep(s, s[0].id); expect(dup.steps).toHaveLength(5); expect(dup.steps[1].id).not.toBe(s[0].id); expect(dup.steps[1].title).toBe("One");
    expect(moveStep(s, s[0].id, 1)[1].id).toBe(s[0].id);
    expect(moveStep(s, s[0].id, -1)).toBe(s); // no-op at the edge returns the same array
    expect(moveStepTo(s, s[3].id, 0)[0].id).toBe(s[3].id);
    const merged = mergeWithNext(s, s[0].id); expect(merged).toHaveLength(3); expect(merged[0].title).toBe("One and Two"); expect(merged[0].text).toContain("First.\nSecond sentence.");
    const split = splitStep(s, s[1].id); expect(split).toHaveLength(5); expect(split[1].text).toBe("Second sentence."); expect(split[2].text).toBe("Third sentence.");
    expect(splitStep(s, s[0].id)).toBe(s); // nothing to split
    expect(deleteStep(s, s[2].id)).toHaveLength(3);
    s = updateStep(s, s[0].id, { title: "Uno" }); expect(s[0].title).toBe("Uno");
    expect(mergeWithNext([newStep("decision")], "x")).toHaveLength(1);
  });
  it("decision steps get two default branches; numbering skips notes/warnings and labels branch steps", () => {
    const d = newStep("decision", { title: "Check" }); expect(d.decision!.branches).toHaveLength(2);
    d.decision!.branches[0].steps = [newStep("action", { title: "A" })];
    const n = numberSteps([newStep("action"), newStep("warning"), d, newStep("action")]);
    expect(n.filter((x) => x.depth === 0).map((x) => x.number)).toEqual(["1", "", "2", "3"]);
    expect(n.find((x) => x.depth === 1)!.number).toBe("2.A.1");
  });
  it("undo/redo history with coalescing", () => {
    const h = new History({ v: 1 });
    h.push({ v: 2 }); h.push({ v: 3 });
    expect(h.undo()).toEqual({ v: 2 }); expect(h.redo()).toEqual({ v: 3 });
    h.undo(); h.push({ v: 9 }); expect(h.canRedo).toBe(false);
    h.replace({ v: 10 }); expect(h.undo()).toEqual({ v: 2 }); // replace did not add an undo entry
  });
});

describe("content model and safe rendering helpers", () => {
  it("validates, defaults and limits", () => {
    const c = emptyContent("sap", "T"); expect(c.templateKey).toBe("sap"); expect(c.steps).toEqual([]);
    expect(() => guideContentSchema.parse({ steps: Array.from({ length: 401 }, () => newStep()) })).toThrow();
    expect(() => guideContentSchema.parse({ title: "x".repeat(301) })).toThrow();
  });
  it("URL scheme allow-list blocks script-capable URLs", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "vbscript:x", " javascript:alert(1)", "JaVaScRiPt:1"]) expect(isSafeUrl(bad)).toBe(false);
    for (const ok of ["https://a.example/x", "http://a.example", "mailto:a@b.c", "/g/WI-0001"]) expect(isSafeUrl(ok)).toBe(true);
  });
  it("inline markup parser never yields HTML", () => {
    expect(parseInline("Click **Save** and `run` <b>x</b>")).toEqual([{ t: "text", v: "Click " }, { t: "bold", v: "Save" }, { t: "text", v: " and " }, { t: "code", v: "run" }, { t: "text", v: " <b>x</b>" }]);
  });
  it("plain text summary used by search and AI includes decisions and blocks", () => {
    const d = newStep("decision", { title: "Value?" }); d.decision!.question = "Over 10k?";
    expect(stepPlainText(d)).toContain("Over 10k?");
    expect(flattenSteps([d])).toHaveLength(1);
  });
});

describe("comparison", () => {
  it("classifies unchanged, changed, added, removed and moved steps", () => {
    const a = emptyContent(); a.steps = steps().filter((s) => s.kind === "action");
    const b = JSON.parse(JSON.stringify(a)) as typeof a;
    b.steps[1].text = "Completely different text about approvals";
    b.steps = [b.steps[2], b.steps[0], b.steps[1], newStep("action", { title: "Brand new thing", text: "Do a new thing entirely." })];
    const d = compareContent(a, b);
    expect(d.summary.added).toBe(1); expect(d.summary.changed).toBe(1);
    expect(d.steps.find((x) => x.status === "changed")!.changes).toContain("text");
    expect(d.steps.some((x) => x.status === "moved")).toBe(true);
    const c = compareContent(a, { ...a, steps: a.steps.slice(0, 2) }); expect(c.summary.removed).toBe(1);
    expect(similarity("Click Save", "click save")).toBe(1); expect(similarity("open the door", "close the window")).toBeLessThan(0.5);
  });
});

describe("policy helpers and hashing", () => {
  it("host restriction supports exact, suffix and wildcard patterns without false positives", () => {
    const p = ["bank.example", "*.payroll.example"];
    expect(hostRestricted("bank.example", p)).toBe(true); expect(hostRestricted("www.bank.example", p)).toBe(true);
    expect(hostRestricted("a.payroll.example", p)).toBe(true); expect(hostRestricted("payroll.example", p)).toBe(true);
    expect(hostRestricted("notbank.example", p)).toBe(false); expect(hostRestricted("bank.example.evil.com", p)).toBe(false);
  });
  it("content hash is stable across key order; audit hashes chain and change with any field", () => {
    expect(contentHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(contentHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
    const e = { orgId: "o", seq: BigInt(1), at: new Date(0), actorId: "u", action: "A", entityType: "T", entityId: "1", summary: "s", detail: { x: 1 } };
    const h1 = auditHash("GENESIS", e); expect(auditHash("GENESIS", { ...e, summary: "t" })).not.toBe(h1); expect(auditHash("other", e)).not.toBe(h1);
  });
});
