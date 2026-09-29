const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);

async function refresh() {
  const rec = await send({ type: "state" });
  const cfg = (await chrome.storage.local.get("cfg")).cfg || {};
  $("baseUrl").value = cfg.baseUrl || "http://localhost:3000";
  $("token").value = cfg.token || "";
  const recording = rec.status === "recording", paused = rec.status === "paused";
  $("status").textContent = recording ? "Recording this tab" : paused ? "Paused" : "Not recording";
  $("start").hidden = recording || paused;
  $("pause").hidden = !(recording || paused);
  $("pause").textContent = paused ? "Resume" : "Pause";
  $("stop").hidden = !(recording || paused);
  $("cfg").open = !cfg.token;
}
function fail(e) { $("error").hidden = false; $("error").textContent = e.message || String(e); }

$("save").onclick = async () => { await chrome.storage.local.set({ cfg: { baseUrl: $("baseUrl").value.trim(), token: $("token").value.trim() } }); refresh(); };
$("start").onclick = async () => {
  $("error").hidden = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const r = await send({ type: "start", tabId: tab.id });
  if (r.error) fail(new Error(r.error)); else window.close();
};
$("pause").onclick = async () => { await send({ type: (await send({ type: "state" })).status === "paused" ? "resume" : "pause" }); refresh(); };
$("stop").onclick = async () => { await send({ type: "stop" }); window.close(); };
refresh();
