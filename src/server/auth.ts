// Server-component auth helpers (cookie session). Services still enforce authorisation themselves.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, ctxFromSessionCookie } from "./session";
import type { Ctx } from "./ctx";
import { hasRole } from "./ctx";
import type { Role } from "../lib/roles";

export async function getCtx(): Promise<Ctx | null> {
  const jar = await cookies();
  const r = await ctxFromSessionCookie(jar.get(SESSION_COOKIE)?.value);
  return r?.ctx ?? null;
}
export async function requireCtx(): Promise<Ctx> {
  const c = await getCtx();
  if (!c) redirect("/login");
  return c;
}
export async function requireRole(...roles: Role[]): Promise<Ctx> {
  const c = await requireCtx();
  if (!hasRole(c, ...roles)) redirect("/?denied=1");
  return c;
}
