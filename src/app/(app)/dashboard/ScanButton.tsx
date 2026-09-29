"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/components/api";
export function ScanButton() {
  const router = useRouter(); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  return <><button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api("/api/admin/health-scan", { method: "POST" }); setMsg(`Scanned ${r.guidesScanned} guides: ${r.recommendationsCreated} new recommendation(s).`); router.refresh(); } catch (e) { setMsg(e instanceof ApiError ? e.message : "Failed"); } finally { setBusy(false); } }}>Run health scan now</button><span role="status" className="muted">{msg}</span></>;
}
