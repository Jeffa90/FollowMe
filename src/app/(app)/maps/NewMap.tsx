"use client";
import { useState } from "react";
import { api, ApiError } from "@/components/api";
export function NewMap() {
  const [t, setT] = useState(""); const [err, setErr] = useState("");
  return <form className="card" onSubmit={async (e) => { e.preventDefault(); try { const m = await api("/api/maps", { body: { title: t } }); window.location.href = `/maps/${m.id}`; } catch (x) { setErr(x instanceof ApiError ? x.message : "Failed"); } }}>
    <label className="field">New process map title<input required value={t} onChange={(e) => setT(e.target.value)} /></label><button className="btn btn-primary">Create draft map</button>{err ? <p role="alert" className="alert danger">{err}</p> : null}</form>;
}
