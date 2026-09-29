"use client";
// Client fetch wrapper: adds the CSRF header (double-submit cookie) and normalises errors.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
function csrf(): string {
  const m = document.cookie.split("; ").find((c) => c.startsWith("fm_csrf="));
  return m ? decodeURIComponent(m.split("=")[1]) : "";
}
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-csrf-token": csrf() };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.body); }
  const res = await fetch(path, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin" });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const e = (data as any)?.error;
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return data as T;
}
