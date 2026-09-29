import { prisma } from "@/server/db";
import { seedBase } from "@/server/seed";
import { createSession, ctxForUserId, CSRF_COOKIE, SESSION_COOKIE } from "@/server/session";
import { resetRateLimits } from "@/server/ratelimit";
import type { Ctx } from "@/server/ctx";

export async function resetDb() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '\_prisma%'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  resetRateLimits();
}

export type Seed = Awaited<ReturnType<typeof seedBase>>;
export async function freshOrg(): Promise<Seed & { ctx: (key: string) => Promise<Ctx> }> {
  await resetDb();
  const s = await seedBase();
  return { ...s, ctx: (key: string) => ctxForUserId(s.users[key].id, "session") };
}

/** Call a route handler as a logged-in user (real session cookie + CSRF token) - exercises auth, CSRF and RBAC exactly as in production. */
export async function call(
  handler: (req: Request, ctx?: { params: Promise<any> }) => Promise<Response>,
  opts: { user?: string; userId?: string; method?: string; url?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string>; noCsrf?: boolean; raw?: BodyInit; bearer?: string },
) {
  const headers: Record<string, string> = { host: "localhost:3000", ...(opts.headers ?? {}) };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  else if (opts.userId) {
    const s = await createSession(opts.userId);
    headers.cookie = `${SESSION_COOKIE}=${s.jwt}; ${CSRF_COOKIE}=${s.csrf}`;
    if (!opts.noCsrf) headers["x-csrf-token"] = s.csrf;
  }
  let body: BodyInit | undefined;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers["content-type"] = "application/json"; }
  const req = new Request(opts.url ?? "http://localhost:3000/api/x", { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json() : undefined;
  return { status: res.status, data, res };
}
