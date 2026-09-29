// Mirrors src/lib/policy.ts hostRestricted() on the server. The server re-checks every event; this is for immediate UX.
export function hostRestricted(host, patterns) {
  const h = String(host || "").toLowerCase();
  return (patterns || []).some((p) => {
    const pat = String(p || "").trim().toLowerCase();
    if (!pat) return false;
    if (pat.startsWith("*.")) return h === pat.slice(2) || h.endsWith(pat.slice(1));
    return h === pat || h.endsWith("." + pat);
  });
}
export function hostOf(url) {
  try { return new URL(url).host; } catch { return ""; }
}

/** Only origin + path ever leave the browser: query strings and fragments routinely carry tokens, emails and other secrets. */
export function safeUrl(url) {
  try { const u = new URL(url); return u.origin + u.pathname; } catch { return ""; }
}
