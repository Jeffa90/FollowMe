// Deterministic (rules-based) conversion of captured activity into editable steps. No AI, no network.
// Input events are EVIDENCE; output steps are editable content that reference the evidence by id.
import { GuideContent, Step, StepFlag, emptyContent, newId, newStep } from "./guide-schema";

export interface CapturedTarget {
  tag?: string; role?: string; name?: string; label?: string; inputType?: string; placeholder?: string; optionLabel?: string;
  checked?: boolean; testId?: string; id?: string; selectorHint?: string; hrefPath?: string; valueLength?: number; sensitive?: boolean;
}
export interface CapturedEvent {
  id: string; seq: number; type: "click" | "change" | "submit" | "navigate"; at: string | Date; url: string; pageTitle: string;
  target: CapturedTarget; viewport?: { width?: number; height?: number }; rect?: { x: number; y: number; w: number; h: number } | null;
  screenshotAssetId?: string | null; contentAssetId?: string | null; redactions?: unknown[]; sensitiveHits?: number;
}

export interface DroppedEvent { eventId: string; reason: string }
export interface GeneratedSuggestion { kind: "warning" | "validation" | "note"; stepId?: string; text: string; reason: string }
export interface Generated {
  content: GuideContent; dropped: DroppedEvent[]; suggestions: GeneratedSuggestion[];
  application: { name: string; host: string };
}

const LOADING = /^(loading|redirecting|please wait|just a moment|signing you in|one moment|processing)\b/i;
const DESTRUCTIVE = /\b(delete|remove|cancel|submit|approve|post|send|pay|confirm|publish|reject|discard|terminate|release)\b/i;
const SUBMITTY = /\b(save|submit|create|post|send|confirm|approve|finish|complete|apply|book|place order|pay)\b/i;
const GENERIC_TAGS = new Set(["div", "span", "body", "html", "main", "section", "p", "td", "tr", "li", "ul", "form", "svg", "path", "img"]);

const t = (d: string | Date) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const clean = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ""; } };

export function appNameFrom(pageTitle: string, host: string): string {
  const parts = pageTitle.split(/\s[-–|·]\s/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1];
  const h = host.replace(/^www\./, "").split(".")[0] ?? host;
  return h ? h.charAt(0).toUpperCase() + h.slice(1) : "the application";
}

export function targetName(tg: CapturedTarget): string {
  return clean(tg.name) || clean(tg.label) || clean(tg.placeholder) || "";
}

function isGenericUnnamed(tg: CapturedTarget) {
  return !targetName(tg) && (!tg.role || tg.role === "generic") && GENERIC_TAGS.has((tg.tag ?? "").toLowerCase());
}

function highlight(ev: CapturedEvent) {
  const r = ev.rect, vw = ev.viewport?.width, vh = ev.viewport?.height;
  if (!r || !vw || !vh) return undefined;
  const pad = 6;
  const x = Math.max(0, (r.x - pad) / vw), y = Math.max(0, (r.y - pad) / vh);
  const w = Math.min(1 - x, (r.w + pad * 2) / vw), h = Math.min(1 - y, (r.h + pad * 2) / vh);
  if (w <= 0 || h <= 0) return undefined;
  return { id: newId("a"), kind: "box" as const, x, y, w, h };
}

/** Build one step from one event. Exposed so a single step can be regenerated from its evidence. */
export function stepFromEvent(ev: CapturedEvent, opts: { assetId?: string | null } = {}): Step {
  const tg = ev.target;
  const name = targetName(tg);
  const role = (tg.role || "").toLowerCase();
  const tag = (tg.tag || "").toLowerCase();
  const flags: StepFlag[] = [];
  let title = "", text = "";

  if (ev.type === "navigate") {
    title = `Open ${clean(ev.pageTitle) || hostOf(ev.url)}`;
    text = `Go to **${clean(ev.pageTitle) || hostOf(ev.url)}** (${hostOf(ev.url)}).`;
  } else if (ev.type === "submit") {
    title = "Submit the form";
    text = name ? `Submit the **${name}** form.` : "Submit the form.";
  } else if (ev.type === "change") {
    const it = (tg.inputType || "").toLowerCase();
    if (tag === "select" || role === "combobox" || role === "listbox") {
      title = `Choose ${tg.optionLabel ? clean(tg.optionLabel) : "an option"}`;
      text = tg.optionLabel ? `Choose **${clean(tg.optionLabel)}** from the **${name || "list"}** list.` : `Choose the required option from the **${name || "list"}** list.`;
    } else if (it === "checkbox") {
      title = `${tg.checked ? "Select" : "Clear"} ${name || "the checkbox"}`;
      text = `${tg.checked ? "Select" : "Clear"} the **${name || "checkbox"}** checkbox.`;
    } else if (it === "radio") {
      title = `Select ${name || "an option"}`;
      text = `Select **${name || "the option"}**.`;
    } else if (it === "file") {
      title = `Upload a file`;
      text = `Upload the required file using **${name || "the file field"}**.`;
    } else if (it === "password" || tg.sensitive) {
      title = `Enter your ${name || "password"}`;
      text = `Enter your **${name || "password"}**. (The value is never recorded.)`;
      flags.push({ code: "sensitive-content", message: "A sensitive field was used. Verify the screenshot does not reveal it.", severity: "warn" });
    } else {
      title = `Enter ${name || "a value"}`;
      text = `Enter the required value in the **${name || "field"}** field.`;
    }
  } else {
    // click
    if (role === "tab") { title = `Open the ${name} tab`; text = `Select the **${name}** tab.`; }
    else if (role === "menuitem" || role === "option") { title = `Select ${name}`; text = `Select **${name}**.`; }
    else if (role === "link" || tag === "a") { title = `Click ${name || "the link"}`; text = `Click the **${name || "highlighted link"}** link.`; }
    else if (role === "button" || tag === "button" || tg.inputType === "submit" || tg.inputType === "button") { title = `Click ${name || "the button"}`; text = `Click **${name || "the highlighted button"}**.`; }
    else if (role === "checkbox" || role === "radio") { title = `Select ${name}`; text = `Select **${name}**.`; }
    else { title = name ? `Click ${name}` : "Click the highlighted area"; text = name ? `Click **${name}**.` : "Click the highlighted area."; }
    if (!name) flags.push({ code: "ambiguous", message: "The clicked element has no accessible name; describe it in your own words.", severity: "warn" });
  }
  if ((ev.sensitiveHits ?? 0) > 0 && !(ev.redactions && ev.redactions.length))
    flags.push({ code: "sensitive-content", message: `The page contained ${ev.sensitiveHits} value(s) that look sensitive (e.g. email, card or ID numbers) and no redaction was applied.`, severity: "warn" });

  const ann = highlight(ev);
  const assetId = opts.assetId ?? ev.contentAssetId ?? undefined;
  const alt = `Screenshot of ${clean(ev.pageTitle) || hostOf(ev.url)}${name ? `, highlighting ${name}` : ""}`;
  return newStep("action", {
    title: title.replace(/\s+/g, " ").trim(), text,
    ...(assetId ? { image: { assetId, alt, annotations: ann ? [ann] : [], ...(ev.screenshotAssetId ? { sourceAssetId: ev.screenshotAssetId } : {}) } } : {}),
    origin: { type: "capture", eventId: ev.id, confidence: name ? 0.85 : 0.4, flags },
  });
}

export function generateFromEvents(eventsIn: CapturedEvent[], opts: { title?: string; templateKey?: string } = {}): Generated {
  const events = [...eventsIn].sort((a, b) => a.seq - b.seq);
  const dropped: DroppedEvent[] = [];
  const kept: CapturedEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const prev = kept[kept.length - 1];
    const next = events[i + 1];
    const name = targetName(ev.target);
    if (ev.type === "navigate") {
      if (LOADING.test(clean(ev.pageTitle)) || ev.url === "about:blank") { dropped.push({ eventId: ev.id, reason: "loading screen" }); continue; }
      if (prev && prev.url === ev.url) { dropped.push({ eventId: ev.id, reason: "same page as previous step" }); continue; }
      if (prev && (prev.type === "click" || prev.type === "submit") && t(ev.at) - t(prev.at) < 4000) {
        dropped.push({ eventId: ev.id, reason: "consequence of previous action (merged)" });
        prev.pageTitle = prev.pageTitle; // keep the acting page's title; navigation is implicit
        continue;
      }
    }
    if (ev.type === "submit" && prev && prev.type === "click" && t(ev.at) - t(prev.at) < 2000) { dropped.push({ eventId: ev.id, reason: "duplicate of the click that submitted the form" }); continue; }
    if (ev.type === "click" && isGenericUnnamed(ev.target)) { dropped.push({ eventId: ev.id, reason: "click on an unnamed generic area (low value)" }); continue; }
    if (ev.type === "click" && next && next.type === "change" && next.target.selectorHint && next.target.selectorHint === ev.target.selectorHint && t(next.at) - t(ev.at) < 30000) {
      dropped.push({ eventId: ev.id, reason: "click into a field that is then filled (merged into the entry step)" }); continue;
    }
    if (prev && prev.type === ev.type && prev.target.selectorHint && prev.target.selectorHint === ev.target.selectorHint && (ev.type === "click" || ev.type === "change")) {
      if (ev.type === "click" && t(ev.at) - t(prev.at) < 1500) { dropped.push({ eventId: ev.id, reason: "duplicate click (double-click)" }); continue; }
      if (ev.type === "change") { kept[kept.length - 1] = ev; dropped.push({ eventId: prev.id, reason: "superseded by a later entry in the same field" }); continue; }
    }
    void name;
    kept.push(ev);
  }

  const steps: Step[] = [];
  const suggestions: GeneratedSuggestion[] = [];
  for (const ev of kept) {
    const step = stepFromEvent(ev);
    const last = steps[steps.length - 1];
    if (last && last.text === step.text && ev.type !== "navigate") {
      last.origin.flags.push({ code: "redundant", message: "This step repeats the previous instruction; consider removing one.", severity: "info" });
    }
    steps.push(step);
    const nm = targetName(ev.target);
    if (ev.type === "click" && nm && DESTRUCTIVE.test(nm)) suggestions.push({ kind: "warning", stepId: step.id, text: `Check the details before you click ${nm}; this action may not be reversible.`, reason: `The step "${nm}" looks like a committing or destructive action.` });
    if (ev.type === "click" && nm && SUBMITTY.test(nm)) suggestions.push({ kind: "validation", stepId: step.id, text: `Confirm that a success message or the expected result appears after ${nm}.`, reason: `A validation check after "${nm}" helps the user know it worked.` });
  }

  const first = kept[0];
  const host = hostOf(first?.url ?? "");
  const app = { name: appNameFrom(first?.pageTitle ?? "", host), host };
  const lastNamed = [...kept].reverse().find((e) => e.type === "click" && targetName(e.target));
  const suggestedTitle = opts.title || (lastNamed ? `${targetName(lastNamed.target)} in ${app.name}` : `Use ${app.name}`);
  const lastEv = kept[kept.length - 1];

  const content = emptyContent(opts.templateKey ?? "general", suggestedTitle);
  content.steps = steps;
  content.purpose = `Show how to ${suggestedTitle.charAt(0).toLowerCase()}${suggestedTitle.slice(1)}.`;
  content.audience = `Users of ${app.name}`;
  content.prerequisites = [`Access to ${app.name}${host ? ` (${host})` : ""}`];
  content.expectedResult = lastEv?.type === "navigate" || !lastEv ? "" : `The action completes without an error message. (Confirm and describe the exact result.)`;
  const cm = (confidence: number, note: string) => ({ confidence, note });
  content.sectionConfidence = {
    title: cm(opts.title ? 1 : 0.4, "Suggested from the recording; please confirm."),
    purpose: cm(0.35, "Drafted from the title; describe the real business purpose."),
    audience: cm(0.3, "Assumed from the application; confirm the audience."),
    prerequisites: cm(0.4, "Only application access could be inferred from the recording."),
    expectedResult: cm(0.25, "Cannot be observed reliably from clicks; describe the result you expect."),
  };
  return { content, dropped, suggestions, application: app };
}
