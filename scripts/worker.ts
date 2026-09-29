// Queue worker: `npm run worker`. Processes imports, webhooks, health scans and retention sweeps.
import "../src/server/services/imports";
import "../src/server/services/webhooks";
import "../src/server/services/maintenance";
import { runOneJob, requeueStale } from "../src/server/jobs";
import { scheduleMaintenance } from "../src/server/services/maintenance";

let stop = false;
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { stop = true; });
console.log("[worker] started");
let lastSched = 0;
while (!stop) {
  if (Date.now() - lastSched > 60_000) { lastSched = Date.now(); await requeueStale().catch(console.error); await scheduleMaintenance().catch(console.error); }
  const worked = await runOneJob().catch((e) => { console.error("[worker] job error", e); return false; });
  if (!worked) await new Promise((r) => setTimeout(r, 1000));
}
console.log("[worker] stopped");
