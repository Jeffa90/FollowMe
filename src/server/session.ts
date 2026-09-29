import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db";
import { env } from "./env";
import type { Ctx } from "./ctx";
import type { Role, Classification } from "../lib/roles";
import { unauthorized } from "./errors";

export const SESSION_COOKIE = "fm_session";
export const CSRF_COOKIE = "fm_csrf";
const SESSION_HOURS = 12;

const key = () => new TextEncoder().encode(env().SESSION_SECRET);

export function csrfTokenFor(sid: string): string {
  return createHmac("sha256", env().SESSION_SECRET).update("csrf:" + sid).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export async function createSession(userId: string, ip?: string) {
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  const s = await prisma.session.create({ data: { userId, expiresAt, ip } });
  const jwt = await new SignJWT({ sid: s.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key());
  return { sid: s.id, jwt, csrf: csrfTokenFor(s.id), expiresAt };
}

export async function revokeSession(sid: string) {
  await prisma.session.updateMany({ where: { id: sid }, data: { revokedAt: new Date() } });
}

export function cookieAttrs(expiresAt: Date, httpOnly: boolean) {
  const secure = env().NODE_ENV === "production";
  return `Path=/; ${httpOnly ? "HttpOnly; " : ""}SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`;
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

type UserRow = Awaited<ReturnType<typeof loadUser>>;
async function loadUser(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

function toCtx(u: NonNullable<UserRow>, via: Ctx["via"], extra: Partial<Ctx> = {}): Ctx {
  return {
    userId: u.id, orgId: u.orgId, name: u.name, email: u.email,
    roles: u.roles as Role[], clearance: u.clearance as Classification,
    siteId: u.siteId, teamId: u.teamId, allSites: u.allSites, siteIds: u.siteIds, via, ...extra,
  };
}

/** Resolve the caller from a session cookie. Returns the session id too (for CSRF verification). */
export async function ctxFromSessionCookie(jwt: string | undefined): Promise<{ ctx: Ctx; sid: string } | null> {
  if (!jwt) return null;
  try {
    const { payload } = await jwtVerify(jwt, key(), { algorithms: ["HS256"] });
    const sid = String(payload.sid);
    const s = await prisma.session.findUnique({ where: { id: sid } });
    if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
    const u = await loadUser(s.userId);
    if (!u || !u.active) return null;
    return { ctx: toCtx(u, "session"), sid };
  } catch {
    return null;
  }
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function issueApiToken(ctx: Ctx, name: string, scopes: string[], days = 30) {
  const raw = "fmt_" + randomBytes(24).toString("base64url");
  const row = await prisma.apiToken.create({
    data: { orgId: ctx.orgId, userId: ctx.userId, name, tokenHash: hashToken(raw), scopes, expiresAt: new Date(Date.now() + days * 86400_000) },
  });
  return { id: row.id, token: raw, expiresAt: row.expiresAt };
}

export async function ctxFromBearer(header: string | null): Promise<Ctx | null> {
  if (!header?.startsWith("Bearer fmt_")) return null;
  const tok = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(header.slice(7)) } });
  if (!tok || tok.revokedAt || tok.expiresAt < new Date()) return null;
  const u = await loadUser(tok.userId);
  if (!u || !u.active) return null;
  await prisma.apiToken.update({ where: { id: tok.id }, data: { lastUsedAt: new Date() } });
  return toCtx(u, "token", { scopes: tok.scopes });
}

export function requireScope(ctx: Ctx, scope: string) {
  if (ctx.via === "token" && !ctx.scopes?.includes(scope)) throw unauthorized(`Token lacks required scope '${scope}'`);
}

/** Build a context for a known user (seeding, workers, tests). Not reachable from any HTTP input. */
export async function ctxForUserId(userId: string, via: Ctx["via"] = "system"): Promise<Ctx> {
  const u = await loadUser(userId);
  if (!u) throw new Error("Unknown user " + userId);
  return toCtx(u, via);
}
