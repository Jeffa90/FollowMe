// Describes the element the user interacted with. Deliberately captures NO typed values and NO keystrokes.
const INTERACTIVE = 'a,button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],input,select,textarea,summary,label';
const clean = (s, n = 120) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export function interactiveTarget(el) {
  if (!(el instanceof Element)) return null;
  const t = el.closest(INTERACTIVE);
  if (t && t.tagName === "LABEL" && t.control) return t.control;
  return t || el;
}

export function implicitRole(el) {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.toLowerCase();
  const tag = el.tagName.toLowerCase();
  if (tag === "a" && el.hasAttribute("href")) return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (["button", "submit", "reset", "image"].includes(t)) return "button";
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    return "textbox";
  }
  return "generic";
}

export function labelText(el) {
  if (el.labels && el.labels.length) return clean(el.labels[0].textContent);
  const id = el.getAttribute("id");
  if (id) { const l = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`); if (l) return clean(l.textContent); }
  const wrap = el.closest("label");
  return wrap ? clean(wrap.textContent) : "";
}

export function accessibleName(el) {
  const aria = el.getAttribute("aria-label");
  if (aria) return clean(aria);
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const txt = by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent || "").join(" ");
    if (clean(txt)) return clean(txt);
  }
  const tag = el.tagName.toLowerCase();
  if (["input", "select", "textarea"].includes(tag)) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (["button", "submit", "reset"].includes(type)) return clean(el.value || el.getAttribute("aria-label") || "");
    return labelText(el) || clean(el.getAttribute("placeholder")) || clean(el.getAttribute("title")) || clean(el.getAttribute("name"));
  }
  if (tag === "img") return clean(el.getAttribute("alt"));
  return clean(el.innerText || el.textContent, 80) || clean(el.getAttribute("title"));
}

export function selectorHint(el) {
  const parts = [];
  let cur = el;
  for (let i = 0; cur && cur.nodeType === 1 && i < 4; i++) {
    const tag = cur.tagName.toLowerCase();
    const id = cur.getAttribute("id");
    const tid = cur.getAttribute("data-testid");
    if (id) { parts.unshift(`${tag}#${id}`); break; }
    if (tid) { parts.unshift(`${tag}[data-testid=${tid}]`); break; }
    const idx = cur.parentElement ? Array.prototype.indexOf.call(cur.parentElement.children, cur) + 1 : 1;
    parts.unshift(`${tag}:nth-child(${idx})`);
    cur = cur.parentElement;
  }
  return parts.join(">").slice(0, 300);
}

export function isSensitiveElement(el, extraSelectors = []) {
  if (!(el instanceof Element)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "password") return true;
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (/cc-|one-time-code|current-password|new-password/.test(ac)) return true;
    const key = `${el.getAttribute("name") || ""} ${el.getAttribute("id") || ""}`;
    if (/pass|pwd|ssn|card|cvv|cvc|iban|otp|pin/i.test(key)) return true;
  }
  if (el.matches("[data-sensitive]")) return true;
  return extraSelectors.some((s) => { try { return el.matches(s); } catch { return false; } });
}

/** Build the whitelisted descriptor sent to the server. `value` is never read except select option labels and boolean checked. */
export function describeTarget(rawEl, extraSelectors = []) {
  const el = interactiveTarget(rawEl);
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  const sensitive = isSensitiveElement(el, extraSelectors);
  const d = {
    tag, role: implicitRole(el), name: sensitive ? clean(labelText(el) || el.getAttribute("aria-label") || "") : accessibleName(el),
    label: ["input", "select", "textarea"].includes(tag) ? labelText(el) : undefined,
    inputType: tag === "input" ? (el.getAttribute("type") || "text").toLowerCase() : undefined,
    placeholder: clean(el.getAttribute("placeholder")) || undefined,
    testId: el.getAttribute("data-testid") || undefined, id: el.getAttribute("id") || undefined, selectorHint: selectorHint(el),
    sensitive: sensitive || undefined,
  };
  if (tag === "select") d.optionLabel = clean(el.selectedOptions?.[0]?.textContent);
  if (tag === "input" && ["checkbox", "radio"].includes(d.inputType)) d.checked = !!el.checked;
  if (tag === "a") { try { d.hrefPath = new URL(el.href).pathname.slice(0, 300); } catch { /* ignore */ } }
  if (!sensitive && ["input", "textarea"].includes(tag) && d.inputType !== "checkbox" && d.inputType !== "radio") d.valueLength = (el.value || "").length; // length only
  for (const k of Object.keys(d)) if (d[k] === undefined || d[k] === "") delete d[k];
  return d;
}
