"use client";
import { useEffect, useState } from "react";
import { api } from "@/components/api";

type U = { email: string; name: string; roles: string[]; jobTitle: string | null };
export function LoginForm() {
  const [users, setUsers] = useState<U[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { fetch("/api/auth/dev-users").then((r) => r.json()).then((d) => setUsers(d.users ?? [])).catch(() => setErr("Could not load users")); }, []);
  async function login(email: string) {
    try { await api("/api/auth/login", { body: { email } }); window.location.href = "/"; } catch (e: any) { setErr(e.message); }
  }
  return (
    <section aria-labelledby="sim">
      <div className="alert warn"><strong>Local role simulation.</strong> Development only: pick a user to sign in as. Production uses Microsoft Entra ID.</div>
      <h2 id="sim">Sign in as…</h2>
      {err ? <p role="alert" className="alert danger">{err}</p> : null}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {users.map((u) => (
          <li key={u.email}>
            <button className="btn" style={{ width: "100%", justifyContent: "space-between" }} onClick={() => login(u.email)}>
              <span>{u.name} <span className="muted">· {u.jobTitle}</span></span>
              <span className="muted">{u.roles.join(", ").replaceAll("_", " ").toLowerCase()}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
