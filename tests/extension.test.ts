// @vitest-environment jsdom
// Pure logic of the browser extension: what is described about a target (never values), sensitivity detection, URL and domain handling.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS modules
import { describeTarget, accessibleName, isSensitiveElement, selectorHint, interactiveTarget } from "../extension/src/lib/descriptor.js";
// @ts-expect-error plain JS modules
import { hostRestricted, safeUrl, hostOf } from "../extension/src/lib/policy.js";

const dom = (html: string) => { document.body.innerHTML = html; return document; };

describe("extension target description", () => {
  it("never reads values of text inputs: only their length; sensitive fields expose neither value nor length", () => {
    dom(`<label for="d">Description</label><input id="d" value="secret text"><input id="p" type="password" aria-label="Password" value="hunter2"><input id="c" name="card_number" value="4111">`);
    const d = describeTarget(document.getElementById("d")!);
    expect(d).toMatchObject({ tag: "input", label: "Description", name: "Description", valueLength: 11 });
    expect(JSON.stringify(d)).not.toContain("secret text");
    const p = describeTarget(document.getElementById("p")!);
    expect(p.sensitive).toBe(true); expect(p.valueLength).toBeUndefined(); expect(JSON.stringify(p)).not.toContain("hunter2");
    const c = describeTarget(document.getElementById("c")!);
    expect(c.sensitive).toBe(true); expect(c.valueLength).toBeUndefined();
  });
  it("uses the accessible name of the nearest interactive element and records select option labels, not raw values", () => {
    dom(`<button id="b"><span id="s">Save</span> <b>claim</b></button><select id="x" aria-label="Category"><option value="secret-code-1">Travel</option><option value="2" selected>Meals</option></select>`);
    expect(interactiveTarget(document.getElementById("s")!)).toBe(document.getElementById("b"));
    expect(describeTarget(document.getElementById("s")!).name).toBe("Save claim");
    const sel = describeTarget(document.getElementById("x")!);
    expect(sel.optionLabel).toBe("Meals"); expect(JSON.stringify(sel)).not.toContain("secret-code");
  });
  it("accessible name precedence: aria-label > aria-labelledby > label > placeholder", () => {
    dom(`<span id="l">Labelled by</span><input id="a" aria-label="Aria" aria-labelledby="l"><input id="b" aria-labelledby="l"><label>Wrapped <input id="c"></label><input id="d" placeholder="Hint">`);
    expect(accessibleName(document.getElementById("a")!)).toBe("Aria");
    expect(accessibleName(document.getElementById("b")!)).toBe("Labelled by");
    expect(accessibleName(document.getElementById("c")!)).toBe("Wrapped");
    expect(accessibleName(document.getElementById("d")!)).toBe("Hint");
  });
  it("detects sensitive elements by type, autocomplete, data attribute and administrator selectors", () => {
    dom(`<input id="a" type="password"><input id="b" autocomplete="cc-number"><div id="c" data-sensitive>x</div><input id="d" name="otp_code"><div id="e" class="salary">1</div><input id="f" name="city">`);
    const $ = (id: string) => document.getElementById(id)!;
    expect(["a", "b", "c", "d"].map((i) => isSensitiveElement($(i)))).toEqual([true, true, true, true]);
    expect(isSensitiveElement($("e"))).toBe(false);
    expect(isSensitiveElement($("e"), [".salary"])).toBe(true);
    expect(isSensitiveElement($("f"))).toBe(false);
  });
  it("selector hints carry structure only (no text)", () => {
    dom(`<div><ul><li>a</li><li><button id="target">Secret button text</button></li></ul></div>`);
    expect(selectorHint(document.getElementById("target")!)).toBe("button#target");
    dom(`<div><p>Alpha</p><p><a href="/x">Beta secret</a></p></div>`);
    expect(selectorHint(document.querySelector("a")!)).not.toContain("secret");
  });
  it("only origin and path ever leave the browser; restricted-domain matching mirrors the server", () => {
    expect(safeUrl("https://user:pw@app.example:8443/a/b?token=SECRET&x=1#frag")).toBe("https://app.example:8443/a/b");
    expect(safeUrl("not a url")).toBe(""); expect(hostOf("https://a.example/x")).toBe("a.example");
    expect(hostRestricted("portal.payroll.example", ["*.payroll.example"])).toBe(true);
    expect(hostRestricted("evilbank.example", ["bank.example"])).toBe(false);
  });
});
