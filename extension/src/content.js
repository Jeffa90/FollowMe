// Content script: injected only into the tab the user chose to record, only while recording. Shows an always-visible banner.
import { describeTarget, isSensitiveElement } from "./lib/descriptor.js";
import { hostRestricted } from "./lib/policy.js";

if (!window.__followmeCapture) {
  window.__followmeCapture = true;
  let status = "idle"; // idle | recording | paused
  let policy = { redactSelectors: [], redactPatterns: [], restrictedDomains: [] };
  let pending = null;
  let banner = null;

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => undefined);

  // ---- visible recording indicator (cannot be hidden by page CSS: closed shadow root, max z-index) ----
  function renderBanner(text, kind) {
    if (!banner) {
      const host = document.createElement("div");
      host.setAttribute("data-followme-banner", "");
      host.style.cssText = "all:initial;position:fixed;top:8px;right:8px;z-index:2147483647;";
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>
        .b{font:600 13px/1.3 system-ui,sans-serif;display:flex;gap:10px;align-items:center;padding:8px 12px;border-radius:10px;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35)}
        .rec{background:#b91c1c}.pause{background:#92400e}.blocked{background:#1e293b}
        .dot{width:10px;height:10px;border-radius:50%;background:#fff}.rec .dot{animation:p 1.2s infinite}
        @keyframes p{50%{opacity:.25}}
        button{font:600 12px system-ui;border:1px solid #fff;background:transparent;color:#fff;border-radius:6px;padding:3px 8px;cursor:pointer}
        button:focus-visible{outline:2px solid #fff;outline-offset:2px}
      </style><div class="b" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span><span id="t"></span><button id="p"></button><button id="s">Stop</button></div>`;
      root.getElementById("p").addEventListener("click", () => send({ type: "toggle-pause" }));
      root.getElementById("s").addEventListener("click", () => send({ type: "stop" }));
      banner = { host, root };
      document.documentElement.appendChild(host);
    }
    const r = banner.root;
    r.querySelector(".b").className = "b " + kind;
    r.getElementById("t").textContent = text;
    r.getElementById("p").textContent = kind === "rec" ? "Pause" : "Resume";
    r.getElementById("p").style.display = kind === "blocked" ? "none" : "";
  }
  function removeBanner() { banner?.host.remove(); banner = null; }

  // ---- sensitive-content masking, applied to the live page just before the screenshot is taken ----
  function collectMasks() {
    const rects = []; let hits = 0; const reasons = new Map();
    const add = (r, why) => { if (r.width > 0 && r.height > 0) { rects.push(r); reasons.set(why, (reasons.get(why) || 0) + 1); } };
    const vw = window.innerWidth, vh = window.innerHeight;
    const inView = (r) => r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    for (const el of document.querySelectorAll("input,textarea,[data-sensitive]")) {
      if (isSensitiveElement(el, policy.redactSelectors)) { const r = el.getBoundingClientRect(); if (inView(r)) add(r, "sensitive-field"); }
    }
    for (const sel of policy.redactSelectors) {
      let list = []; try { list = document.querySelectorAll(sel); } catch { /* bad selector */ }
      for (const el of list) { const r = el.getBoundingClientRect(); if (inView(r)) add(r, "admin-selector"); }
    }
    const res = policy.redactPatterns.map((p) => { try { return { n: p.name, re: new RegExp(p.regex, "g") }; } catch { return null; } }).filter(Boolean);
    if (res.length) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let count = 0, node;
      while ((node = walker.nextNode()) && count++ < 4000) {
        const txt = node.nodeValue; if (!txt || txt.length < 5) continue;
        const parent = node.parentElement; if (!parent || parent.closest("script,style,[data-followme-banner]")) continue;
        for (const { n, re } of res) {
          re.lastIndex = 0; let m;
          while ((m = re.exec(txt))) {
            hits++;
            const range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
            for (const r of range.getClientRects()) if (inView(r)) add(r, n);
          }
        }
      }
    }
    return { rects, hits, reasons: [...reasons].map(([reason, count]) => ({ reason, count })) };
  }
  function applyMasks(rects) {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-followme-mask", "");
    wrap.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
    for (const r of rects) {
      const d = document.createElement("div");
      d.style.cssText = `position:fixed;left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px;background:#000;`;
      wrap.appendChild(d);
    }
    document.documentElement.appendChild(wrap);
    return () => wrap.remove();
  }
  /** Mask sensitive regions, ask the background for a screenshot of THIS (recorded, active) tab, then remove the masks. */
  async function shot(eventId) {
    if (hostRestricted(location.host, policy.restrictedDomains)) return { screenshot: null, redactions: [], sensitiveHits: 0 };
    const { rects, hits, reasons } = collectMasks();
    const unmask = applyMasks(rects);
    const meta = { redactions: reasons, sensitiveHits: rects.length ? 0 : hits };
    try {
      await new Promise((r) => requestAnimationFrame(() => r()));
      const res = await send({ type: "shot", id: eventId, ...meta });
      return { screenshot: res?.dataUrl ?? null, ...meta };
    } finally { unmask(); }
  }

  const baseEvent = (type, el) => {
    const target = describeTarget(el, policy.redactSelectors) || {};
    const b = (el instanceof Element ? el.closest("input,select,textarea,button,a,[role]") || el : document.body).getBoundingClientRect();
    return { type, at: new Date().toISOString(), url: location.href, pageTitle: document.title.slice(0, 300), target,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      rect: { x: b.left, y: b.top, w: b.width, h: b.height } };
  };

  // The event is handed to the background IMMEDIATELY (the page may navigate away within milliseconds); the background
  // merges the screenshot when it arrives. A click is only confirmed when the `click` event follows the `pointerdown`.
  let seq = 0;
  function begin(type, el, confirmNow) {
    const id = `${Date.now().toString(36)}-${seq++}`;
    send({ type: "event-start", id, event: baseEvent(type, el), confirmed: confirmNow });
    void shot(id);
    return id;
  }

  // Only pointer / change / submit events. NO keydown/keypress/keyup/input listeners: keystrokes are never observed.
  document.addEventListener("pointerdown", (e) => {
    if (status !== "recording" || !e.isTrusted || e.composedPath().some((n) => n === banner?.host)) return;
    pending = { id: begin("click", e.target, false), t: Date.now() };
  }, true);
  document.addEventListener("click", (e) => {
    if (status !== "recording" || !pending) return;
    if (Date.now() - pending.t < 5000 && e.isTrusted) send({ type: "event-confirm", id: pending.id });
    pending = null;
  }, true);
  document.addEventListener("change", (e) => { if (status === "recording" && e.isTrusted) begin("change", e.target, true); }, true);
  document.addEventListener("submit", (e) => {
    if (status !== "recording" || !e.isTrusted) return;
    const ev = baseEvent("submit", e.target);
    const id = `${Date.now().toString(36)}-${seq++}`;
    ev.target = { tag: "form", name: e.target.getAttribute("aria-label") || e.target.getAttribute("name") || undefined, selectorHint: ev.target.selectorHint };
    send({ type: "event-start", id, event: ev, confirmed: true });
    void shot(id);
  }, true);

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === "state") {
      status = msg.status;
      if (msg.policy) policy = { ...policy, ...msg.policy };
      if (status === "recording") renderBanner("FollowMe is recording this tab", "rec");
      else if (status === "paused") renderBanner(msg.reason ? `Recording paused: ${msg.reason}` : "FollowMe recording paused", msg.reason ? "blocked" : "pause");
      else removeBanner();
      reply?.({ ok: true });
    }
    if (msg.type === "shot-now") { shot(undefined).then(reply); return true; }
  });
  send({ type: "content-ready" });
}
