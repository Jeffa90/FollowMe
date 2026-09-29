"use client";
import { useState } from "react";
import { api, ApiError } from "@/components/api";

export function TokenForm() {
  const [name, setName] = useState("My browser");
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  return (
    <section className="card" aria-labelledby="tk-h"><h2 id="tk-h">2. Capture token</h2>
      <p className="muted">A scoped token that can only upload recordings. It expires in 30 days and can be revoked by an administrator.</p>
      <label className="field">Token name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button className="btn btn-primary" onClick={async () => { setErr(""); try { const r = await api("/api/auth/token", { body: { name, scopes: ["capture"], days: 30 } }); setToken(r.token); } catch (e) { setErr(e instanceof ApiError ? e.message : "Failed"); } }}>Create token</button>
      {token ? <p role="status" className="alert ok" style={{ marginTop: 12 }}>Copy it now; it is shown once:<br /><code data-testid="capture-token" style={{ wordBreak: "break-all" }}>{token}</code></p> : null}
      {err ? <p role="alert" className="alert danger">{err}</p> : null}
    </section>
  );
}
