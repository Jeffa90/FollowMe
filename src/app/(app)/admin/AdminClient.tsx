"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/components/api";
import { ROLES, ROLE_LABELS, CLASSIFICATIONS } from "@/lib/roles";

type User = { id: string; name: string; email: string; roles: string[]; active: boolean; clearance: string; jobTitle: string | null };
type Settings = { aiPolicy: any; capturePolicy: any; retentionPolicy: any; legalHold: boolean; dataRegion: string; name: string };

function useAct() {
  const router = useRouter(); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok = "Saved") => { setMsg(null); try { await fn(); setMsg({ ok: true, t: ok }); router.refresh(); } catch (e) { setMsg({ ok: false, t: e instanceof ApiError ? e.message : "Failed" }); } };
  return { run, msg: msg ? <p role={msg.ok ? "status" : "alert"} className={`alert ${msg.ok ? "ok" : "danger"}`}>{msg.t}</p> : null };
}

export function AdminClient({ users, settings, registry, teams, sites }: { users: User[]; settings: Settings; registry: any; teams: { id: string; name: string }[]; sites: { id: string; name: string }[] }) {
  const { run, msg } = useAct();
  const [ai, setAi] = useState(settings.aiPolicy);
  const [cap, setCap] = useState({ ...settings.capturePolicy, restrictedDomains: settings.capturePolicy.restrictedDomains.join("\n"), redactSelectors: settings.capturePolicy.redactSelectors.join("\n") });
  const [ret, setRet] = useState(settings.retentionPolicy);
  const [hold, setHold] = useState(settings.legalHold);
  const [wh, setWh] = useState({ url: "", events: ["guide.published"] as string[] });
  const [secret, setSecret] = useState("");
  const [reg, setReg] = useState({ type: "retired", kind: "TCODE", value: "", replacement: "", note: "", term: "", expansions: "", code: "", label: "" });
  const [tpl, setTpl] = useState<Record<string, string>>({});
  const tog = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {msg}
      <section className="card" aria-labelledby="us"><h2 id="us">Users and roles</h2>
        <div className="table-wrap"><table className="table"><thead><tr><th scope="col">User</th><th scope="col">Roles</th><th scope="col">Clearance</th><th scope="col">Active</th></tr></thead><tbody>
          {users.map((u) => (
            <tr key={u.id}><td>{u.name}<br /><span className="muted">{u.email}</span></td>
              <td><fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="visually-hidden">Roles for {u.name}</legend>{ROLES.map((r) => <label key={r} className="inline" style={{ marginRight: 8 }}><input type="checkbox" checked={u.roles.includes(r)} onChange={() => { const roles = tog(u.roles, r); if (roles.length) run(() => api("/api/admin/users", { method: "PATCH", body: { userId: u.id, roles } })); }} /> {ROLE_LABELS[r as keyof typeof ROLE_LABELS]}</label>)}</fieldset></td>
              <td><select aria-label={`Clearance for ${u.name}`} value={u.clearance} onChange={(e) => run(() => api("/api/admin/users", { method: "PATCH", body: { userId: u.id, clearance: e.target.value } }))}>{CLASSIFICATIONS.map((c) => <option key={c}>{c}</option>)}</select></td>
              <td><label className="inline"><input type="checkbox" checked={u.active} onChange={(e) => run(() => api("/api/admin/users", { method: "PATCH", body: { userId: u.id, active: e.target.checked } }), e.target.checked ? "Reactivated" : "Deactivated: sessions and tokens revoked")} /> {u.active ? "Active" : "Inactive"}</label></td></tr>
          ))}
        </tbody></table></div>
      </section>

      <div className="grid cols-2">
        <section className="card" aria-labelledby="ai"><h2 id="ai">AI policy</h2>
          <label className="inline" style={{ display: "flex" }}><input type="checkbox" checked={ai.enabled} onChange={(e) => setAi({ ...ai, enabled: e.target.checked })} /> AI features enabled (organisation kill switch)</label>
          <label className="inline" style={{ display: "flex" }}><input type="checkbox" checked={ai.externalAllowed} onChange={(e) => setAi({ ...ai, externalAllowed: e.target.checked })} /> Allow external AI providers</label>
          <label className="inline" style={{ display: "flex" }}><input type="checkbox" checked={ai.noTrainingContractConfirmed} onChange={(e) => setAi({ ...ai, noTrainingContractConfirmed: e.target.checked })} /> Contract confirms no training on our content</label>
          <label className="field">Highest classification sent externally<select value={ai.externalMaxClassification} onChange={(e) => setAi({ ...ai, externalMaxClassification: e.target.value })}>{CLASSIFICATIONS.map((c) => <option key={c}>{c}</option>)}</select></label>
          <fieldset><legend>Disable AI for teams</legend>{teams.map((t) => <label key={t.id} className="inline" style={{ marginRight: 8 }}><input type="checkbox" checked={ai.disabledTeamIds.includes(t.id)} onChange={() => setAi({ ...ai, disabledTeamIds: tog(ai.disabledTeamIds, t.id) })} /> {t.name}</label>)}</fieldset>
          <fieldset><legend>Disable AI for content types</legend>{registry.templates.map((t: any) => <label key={t.key} className="inline" style={{ marginRight: 8 }}><input type="checkbox" checked={ai.disabledTemplateKeys.includes(t.key)} onChange={() => setAi({ ...ai, disabledTemplateKeys: tog(ai.disabledTemplateKeys, t.key) })} /> {t.name}</label>)}</fieldset>
          <fieldset><legend>Disable AI for classifications</legend>{CLASSIFICATIONS.map((c) => <label key={c} className="inline" style={{ marginRight: 8 }}><input type="checkbox" checked={ai.disabledClassifications.includes(c)} onChange={() => setAi({ ...ai, disabledClassifications: tog(ai.disabledClassifications, c) })} /> {c}</label>)}</fieldset>
          <button className="btn btn-primary" onClick={() => run(() => api("/api/admin/settings", { method: "PUT", body: { aiPolicy: ai } }))}>Save AI policy</button>
        </section>
        <section className="card" aria-labelledby="cp"><h2 id="cp">Capture policy</h2>
          <label className="inline" style={{ display: "flex" }}><input type="checkbox" checked={cap.enabled} onChange={(e) => setCap({ ...cap, enabled: e.target.checked })} /> Capture enabled (kill switch)</label>
          <label className="field">Restricted domains (one per line, e.g. <code>*.payroll.example</code>)<textarea value={cap.restrictedDomains} onChange={(e) => setCap({ ...cap, restrictedDomains: e.target.value })} /></label>
          <label className="field">Always-mask CSS selectors (administrator-enforced redaction)<textarea value={cap.redactSelectors} onChange={(e) => setCap({ ...cap, redactSelectors: e.target.value })} /></label>
          <p className="muted">Default text patterns (email, card number, NI number) are always masked in screenshots.</p>
          <button className="btn btn-primary" onClick={() => run(() => api("/api/admin/settings", { method: "PUT", body: { capturePolicy: { ...cap, restrictedDomains: cap.restrictedDomains.split("\n").map((x: string) => x.trim()).filter(Boolean), redactSelectors: cap.redactSelectors.split("\n").map((x: string) => x.trim()).filter(Boolean) } } }))}>Save capture policy</button>
        </section>
        <section className="card" aria-labelledby="rt"><h2 id="rt">Retention &amp; legal hold</h2>
          {(["searchLogDays", "viewEventDays", "discardedCaptureDays", "staleUnprocessedCaptureDays"] as const).map((k) => <label key={k} className="field">{k.replace(/([A-Z])/g, " $1").toLowerCase()}<input type="number" min={1} value={ret[k]} onChange={(e) => setRet({ ...ret, [k]: Number(e.target.value) })} /></label>)}
          <label className="inline" style={{ display: "flex" }}><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} /> Organisation legal hold (suspends all retention deletion)</label>
          <p className="muted">Data residency label: {settings.dataRegion}. Published guides and imported source documents are never deleted by retention.</p>
          <button className="btn btn-primary" onClick={() => run(() => api("/api/admin/settings", { method: "PUT", body: { retentionPolicy: ret, legalHold: hold } }))}>Save retention</button>
        </section>
        <section className="card" aria-labelledby="wh"><h2 id="wh">Webhooks (publication events)</h2>
          <ul>{registry.webhooks.map((w: any) => <li key={w.id}>{w.url} <span className="muted">{w.events.join(", ")}</span></li>)}</ul>
          <label className="field">HTTPS URL<input value={wh.url} onChange={(e) => setWh({ ...wh, url: e.target.value })} placeholder="https://example.com/hooks/followme" /></label>
          <button className="btn" onClick={() => run(async () => { const r = await api("/api/admin/webhooks", { body: wh }); setSecret(r.secret); }, "Webhook created")}>Add webhook</button>
          {secret ? <p role="status" className="alert ok">Signing secret (shown once): <code>{secret}</code></p> : null}
          <p className="muted">Deliveries carry <code>x-followme-signature</code> = HMAC-SHA256(secret, timestamp.body). Private and loopback targets are refused.</p>
        </section>
      </div>

      <div className="grid cols-2">
        <section className="card" aria-labelledby="rg"><h2 id="rg">Taxonomy, synonyms and retired references</h2>
          <label className="field">Add<select value={reg.type} onChange={(e) => setReg({ ...reg, type: e.target.value, kind: e.target.value === "retired" ? "TCODE" : e.target.value === "synonym" ? "SYNONYM" : "PROCESS" })}><option value="retired">Retired system / transaction code</option><option value="synonym">Synonym or acronym</option><option value="taxonomy">Taxonomy term</option></select></label>
          {reg.type === "retired" ? <><label className="field">Kind<select value={reg.kind} onChange={(e) => setReg({ ...reg, kind: e.target.value })}><option>TCODE</option><option>SYSTEM</option><option>URL_PATTERN</option></select></label><label className="field">Value<input value={reg.value} onChange={(e) => setReg({ ...reg, value: e.target.value })} /></label><label className="field">Replacement<input value={reg.replacement} onChange={(e) => setReg({ ...reg, replacement: e.target.value })} /></label><label className="field">Note<input value={reg.note} onChange={(e) => setReg({ ...reg, note: e.target.value })} /></label></> : null}
          {reg.type === "synonym" ? <><label className="field">Kind<select value={reg.kind} onChange={(e) => setReg({ ...reg, kind: e.target.value })}><option>SYNONYM</option><option>ACRONYM</option></select></label><label className="field">Term<input value={reg.term} onChange={(e) => setReg({ ...reg, term: e.target.value })} /></label><label className="field">Alternatives / expansion (comma separated)<input value={reg.expansions} onChange={(e) => setReg({ ...reg, expansions: e.target.value })} /></label></> : null}
          {reg.type === "taxonomy" ? <><label className="field">Kind<select value={reg.kind} onChange={(e) => setReg({ ...reg, kind: e.target.value })}>{["PROCESS", "FUNCTION", "CATEGORY", "SYSTEM", "BUSINESS_UNIT", "DEPARTMENT"].map((k) => <option key={k}>{k}</option>)}</select></label><label className="field">Code<input value={reg.code} onChange={(e) => setReg({ ...reg, code: e.target.value })} /></label><label className="field">Label<input value={reg.label} onChange={(e) => setReg({ ...reg, label: e.target.value })} /></label></> : null}
          <button className="btn btn-primary" onClick={() => run(() => api("/api/admin/registry", { body: reg.type === "retired" ? { type: "retired", kind: reg.kind, value: reg.value, replacement: reg.replacement || null, note: reg.note } : reg.type === "synonym" ? { type: "synonym", kind: reg.kind, term: reg.term, expansions: reg.expansions.split(",").map((x) => x.trim()).filter(Boolean) } : { type: "taxonomy", kind: reg.kind, code: reg.code, label: reg.label } }))}>Save entry</button>
          <h3>Retired references ({registry.retired.length})</h3><ul>{registry.retired.map((r: any) => <li key={r.id}>{r.kind} <strong>{r.value}</strong>{r.replacement ? ` → ${r.replacement}` : ""}</li>)}</ul>
          <h3>Synonyms and acronyms ({registry.synonyms.length})</h3><ul>{registry.synonyms.map((r: any) => <li key={r.id}>{r.kind.toLowerCase()} <strong>{r.term}</strong>: {r.expansions.join(", ")}</li>)}</ul>
          <h3>Taxonomy ({registry.taxonomy.length})</h3><ul>{registry.taxonomy.map((r: any) => <li key={r.id}>{r.kind} {r.code}: {r.label}</li>)}</ul>
        </section>
        <section className="card" aria-labelledby="wf"><h2 id="wf">Approval routes</h2>
          <ul>{registry.workflows.map((w: any) => <li key={w.id}><strong>{w.name}</strong>{w.isDefault ? " (default)" : ""}: {w.reviewMin} reviewer(s), then {(w.stages as any[]).map((s) => `${s.name} (${s.role.toLowerCase().replace("_", " ")} × ${s.minApprovals})`).join(" → ")}</li>)}</ul>
          <h2>Templates</h2>
          {registry.templates.map((t: any) => (
            <details key={t.id}><summary>{t.name} <span className="muted">({t.key})</span></summary>
              <label className="field">Definition (JSON)<textarea style={{ minHeight: 220, fontFamily: "monospace" }} value={tpl[t.id] ?? JSON.stringify(t.definition, null, 2)} onChange={(e) => setTpl({ ...tpl, [t.id]: e.target.value })} /></label>
              <button className="btn btn-sm" onClick={() => run(() => api("/api/admin/registry", { method: "PUT", body: { templateId: t.id, definition: JSON.parse(tpl[t.id] ?? JSON.stringify(t.definition)) } }), "Template saved")}>Save template</button>
            </details>
          ))}
          <h2>API tokens</h2>
          <ul>{registry.tokens.map((t: any) => <li key={t.id}>{t.name} ({t.scopes.join(", ")}) {t.revokedAt ? <span className="badge neutral">revoked</span> : <button className="btn btn-sm" onClick={() => run(() => api("/api/admin/registry", { method: "DELETE", body: { tokenId: t.id } }), "Token revoked")}>Revoke</button>}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}
