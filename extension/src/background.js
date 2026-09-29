// Service worker: recording state machine, screenshot capture, uploads. State lives in chrome.storage.session
// because MV3 workers are ephemeral. Recording is explicit, visible (badge + on-page banner) and scoped to ONE tab.
import { hostOf, hostRestricted, safeUrl } from "./lib/policy.js";

const VERSION = chrome.runtime.getManifest().version;
const S = chrome.storage.session, L = chrome.storage.local;

const getState = async () => (await S.get("rec")).rec || { status: "idle" };
const setState = (rec) => S.set({ rec });
const getConfig = async () => (await L.get("cfg")).cfg || { baseUrl: "http://localhost:3000", token: "" };

async function api(path, init = {}) {
  const cfg = await getConfig();
  const res = await fetch(cfg.baseUrl.replace(/\/$/, "") + path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}`, ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error?.message || `HTTP ${res.status}`), { status: res.status, code: body?.error?.code });
  return body;
}

function badge(status) {
  if (status === "recording") { chrome.action.setBadgeText({ text: "REC" }); chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" }); }
  else if (status === "paused") { chrome.action.setBadgeText({ text: "II" }); chrome.action.setBadgeBackgroundColor({ color: "#92400e" }); }
  else chrome.action.setBadgeText({ text: "" });
}

async function pushState(rec, reason) {
  badge(rec.status);
  if (rec.tabId == null) return;
  await chrome.tabs.sendMessage(rec.tabId, { type: "state", status: rec.status === "recording" ? "recording" : rec.status === "paused" ? "paused" : "idle", policy: rec.policy, reason }).catch(() => undefined);
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

let queue = Promise.resolve();
function upload(rec, event) {
  queue = queue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await api(`/api/capture/sessions/${rec.sessionId}/events`, { method: "POST", body: JSON.stringify(event) }); return; }
      catch (e) {
        if (e.code === "restricted_domain") { await pause(e.message); return; }
        if (e.status && e.status < 500 && e.status !== 429) { console.warn("[FollowMe] event rejected:", e.message); return; }
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  });
  return queue;
}

async function record(rec, partial) {
  const seq = rec.seq++;
  await setState(rec);
  return upload(rec, { seq, ...partial, url: safeUrl(partial.url) });
}

// Events wait here for (a) confirmation that a click really happened and (b) their screenshot.
const pendingEvents = new Map();
async function tryFlush(id, timedOut = false) {
  const p = pendingEvents.get(id);
  if (!p) return;
  if (!p.confirmed) { if (timedOut) { clearTimeout(p.timer); pendingEvents.delete(id); } return; } // pointerdown without click (drag/scroll): discard
  if (!p.shot && !timedOut) return;
  clearTimeout(p.timer);
  pendingEvents.delete(id);
  const rec = await getState();
  if (rec.status !== "recording") return;
  await record(rec, { ...p.event, ...(p.shot ?? {}) });
}

async function start(tabId) {
  const cfg = await getConfig();
  if (!cfg.token) throw new Error("Not configured: add your FollowMe URL and capture token in the popup.");
  const tab = await chrome.tabs.get(tabId);
  const policy = await api("/api/capture/policy");
  if (!policy.enabled) throw new Error("Capture is disabled by your organisation.");
  if (hostRestricted(hostOf(tab.url), policy.restrictedDomains)) throw new Error(`Recording is not permitted on ${hostOf(tab.url)}.`);
  const s = await api("/api/capture/sessions", { method: "POST", body: JSON.stringify({ startUrl: safeUrl(tab.url), title: tab.title, extensionVersion: VERSION }) });
  const rec = { status: "recording", sessionId: s.id, tabId, seq: 0, policy, lastUrl: safeUrl(tab.url), baseUrl: cfg.baseUrl };
  await setState(rec);
  await inject(tabId);
  await pushState(rec);
  const shot = await chrome.tabs.sendMessage(tabId, { type: "shot-now" }).catch(() => null);
  await record(rec, { type: "navigate", at: new Date().toISOString(), url: tab.url, pageTitle: tab.title || "", target: {}, viewport: {}, screenshot: shot?.screenshot ?? undefined, redactions: shot?.redactions ?? [], sensitiveHits: shot?.sensitiveHits ?? 0 });
  return { sessionId: s.id };
}

async function pause(reason) {
  const rec = await getState();
  if (rec.status !== "recording") return;
  rec.status = "paused"; // local state first: the pause is immediate even if the network is slow
  await setState(rec);
  await pushState(rec, reason);
  api(`/api/capture/sessions/${rec.sessionId}`, { method: "PATCH", body: JSON.stringify({ status: "PAUSED" }) }).catch(() => undefined);
}
async function resume() {
  const rec = await getState();
  if (rec.status !== "paused") return;
  const tab = await chrome.tabs.get(rec.tabId);
  if (hostRestricted(hostOf(tab.url), rec.policy.restrictedDomains)) { await pushState(rec, `restricted domain ${hostOf(tab.url)}`); return; }
  await api(`/api/capture/sessions/${rec.sessionId}`, { method: "PATCH", body: JSON.stringify({ status: "RECORDING" }) });
  rec.status = "recording";
  await setState(rec);
  await inject(rec.tabId).catch(() => undefined);
  await pushState(rec);
}
async function stop() {
  const rec = await getState();
  if (rec.status === "idle") return {};
  await queue;
  await api(`/api/capture/sessions/${rec.sessionId}`, { method: "PATCH", body: JSON.stringify({ status: "STOPPED" }) }).catch(() => undefined);
  const done = { status: "idle" };
  await setState(done);
  await pushState({ ...rec, status: "idle" });
  badge("idle");
  await chrome.tabs.create({ url: `${rec.baseUrl.replace(/\/$/, "")}/captures/${rec.sessionId}` });
  return { sessionId: rec.sessionId };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === "start") return start(msg.tabId);
    if (msg.type === "state") return getState();
    if (msg.type === "pause") return pause();
    if (msg.type === "resume") return resume();
    if (msg.type === "toggle-pause") { const r = await getState(); return r.status === "recording" ? pause() : resume(); }
    if (msg.type === "stop") return stop();
    if (msg.type === "shot") {
      const rec = await getState();
      if (rec.status !== "recording" || sender.tab?.id !== rec.tabId) return { dataUrl: null };
      // Never screenshot a tab other than the recorded one: captureVisibleTab captures whichever tab is active in the window.
      const [active] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
      if (active?.id !== rec.tabId) return { dataUrl: null };
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }).catch(() => null);
      const p = pendingEvents.get(msg.id);
      if (p) { p.shot = { screenshot: dataUrl ?? undefined, redactions: msg.redactions ?? [], sensitiveHits: msg.sensitiveHits ?? 0 }; tryFlush(msg.id); }
      return { dataUrl };
    }
    if (msg.type === "event-start") {
      // Register synchronously: the confirm message can arrive before any await below completes.
      const p = { event: msg.event, confirmed: !!msg.confirmed, shot: null, born: Date.now() };
      p.timer = setTimeout(() => tryFlush(msg.id, true), 2500); // page may have navigated before its screenshot returned
      pendingEvents.set(msg.id, p);
      const rec = await getState();
      const drop = () => { clearTimeout(p.timer); pendingEvents.delete(msg.id); };
      if (rec.status !== "recording" || sender.tab?.id !== rec.tabId) return drop(); // paused/stopped: drop
      if (hostRestricted(hostOf(msg.event.url), rec.policy.restrictedDomains)) { drop(); await pause(`restricted domain ${hostOf(msg.event.url)}`); }
      return;
    }
    if (msg.type === "event-confirm") {
      const p = pendingEvents.get(msg.id);
      if (p) { p.confirmed = true; tryFlush(msg.id); }
      return;
    }
    if (msg.type === "content-ready") {
      const rec = await getState();
      if (sender.tab?.id === rec.tabId && rec.status !== "idle") await pushState(rec);
    }
  })().then((r) => reply(r ?? {}), (e) => reply({ error: e.message }));
  return true;
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "toggle-pause") return;
  const r = await getState();
  if (r.status === "recording") await pause(); else if (r.status === "paused") await resume().catch(() => undefined);
});

// Page navigations within the recorded tab
async function onNav(details) {
  const rec = await getState();
  if (rec.status === "idle" || details.tabId !== rec.tabId || details.frameId !== 0) return;
  const url = details.url;
  if (hostRestricted(hostOf(url), rec.policy.restrictedDomains)) { await pause(`restricted domain ${hostOf(url)}`); return; }
  if (rec.status !== "recording") return;
  await inject(rec.tabId).catch(() => undefined);
  await pushState(rec);
  if (safeUrl(url) === rec.lastUrl) return;
  rec.lastUrl = safeUrl(url);
  await setState(rec);
  await new Promise((r) => setTimeout(r, 400)); // let the page paint
  const tab = await chrome.tabs.get(rec.tabId).catch(() => null);
  const shot = await chrome.tabs.sendMessage(rec.tabId, { type: "shot-now" }).catch(() => null);
  const cur = await getState();
  if (cur.status !== "recording") return;
  await record(cur, { type: "navigate", at: new Date().toISOString(), url, pageTitle: tab?.title || "", target: {}, viewport: {}, screenshot: shot?.screenshot ?? undefined, redactions: shot?.redactions ?? [], sensitiveHits: shot?.sensitiveHits ?? 0 });
}
chrome.webNavigation.onCompleted.addListener(onNav);
chrome.webNavigation.onHistoryStateUpdated.addListener(onNav);
chrome.tabs.onRemoved.addListener(async (tabId) => { const r = await getState(); if (r.status !== "idle" && r.tabId === tabId) await stop(); });

// Test seam for automated end-to-end tests (reachable only from the extension's own service-worker context).
globalThis.__followme = { start, pause, resume, stop, state: getState };
