// Route wrapper: authentication, CSRF, rate limiting, error mapping. All API routes go through `route()`.
import { ZodError, ZodType } from "zod";
import { randomUUID } from "node:crypto";
import { AppError, badRequest, forbidden, unauthorized } from "./errors";
import { Ctx } from "./ctx";
import { CSRF_COOKIE, SESSION_COOKIE, csrfTokenFor, ctxFromBearer, ctxFromSessionCookie, parseCookies, safeEqual } from "./session";
import { rateLimit } from "./ratelimit";
import { env } from "./env";

export interface RouteOpts {
  /** Public routes skip authentication (e.g. login). */
  public?: boolean;
  /** Accept scoped API tokens (extension, integrations). Default false = session cookie only. */
  allowToken?: boolean;
  /** Rate limit per user (or per IP for public routes): [limit, windowMs]. */
  limit?: [number, number];
}
type Handler<P> = (a: { ctx: Ctx; req: Request; params: P; ip: string; requestId: string; url: URL }) => Promise<Response | unknown>;

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(init.headers ?? {}) },
  });

export function errorResponse(e: unknown, requestId: string): Response {
  if (e instanceof AppError) return json({ error: { code: e.code, message: e.message, details: e.details, requestId } }, { status: e.status });
  if (e instanceof ZodError) {
    return json({ error: { code: "validation_failed", message: "Invalid input", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })), requestId } }, { status: 400 });
  }
  console.error(`[${requestId}]`, e);
  return json({ error: { code: "internal_error", message: "Unexpected error", requestId } }, { status: 500 });
}

function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser client; CSRF token check below still applies for cookie auth
  const allowed = new URL(env().APP_BASE_URL).origin;
  const host = req.headers.get("host");
  const o = new URL(origin);
  if (o.origin !== allowed && o.host !== host) throw forbidden("Cross-origin request blocked");
}

export function route<P = Record<string, string>>(opts: RouteOpts, handler: Handler<P>) {
  return async (req: Request, routeCtx?: { params: Promise<P> | P }): Promise<Response> => {
    const requestId = randomUUID();
    const ip = clientIp(req);
    try {
      const params = (routeCtx ? await routeCtx.params : {}) as P;
      const url = new URL(req.url);
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      let ctx: Ctx | null = null;

      if (!opts.public) {
        const bearer = req.headers.get("authorization");
        if (bearer) {
          if (!opts.allowToken) throw unauthorized("API tokens are not accepted on this endpoint");
          ctx = await ctxFromBearer(bearer);
        } else {
          const cookies = parseCookies(req.headers.get("cookie"));
          const res = await ctxFromSessionCookie(cookies[SESSION_COOKIE]);
          if (res) {
            ctx = res.ctx;
            if (mutating) {
              checkOrigin(req);
              const hdr = req.headers.get("x-csrf-token") ?? "";
              if (!hdr || !safeEqual(hdr, csrfTokenFor(res.sid)) || !cookies[CSRF_COOKIE]) throw forbidden("Missing or invalid CSRF token");
            }
          }
        }
        if (!ctx) throw unauthorized();
        ctx = { ...ctx, ip, requestId };
      } else if (mutating) {
        checkOrigin(req);
      }
      const [limit, windowMs] = opts.limit ?? [300, 60_000];
      rateLimit(`${req.method}:${url.pathname.replace(/[a-z0-9]{20,}/gi, ":id")}:${ctx?.userId ?? ip}`, limit, windowMs);

      const out = await handler({ ctx: ctx as Ctx, req, params, ip, requestId, url });
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 40 * 1024 * 1024) throw badRequest("Request body too large");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Body must be valid JSON");
  }
  return schema.parse(body);
}

export function parseQuery<T>(url: URL, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}
