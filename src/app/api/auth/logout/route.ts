import { json, route } from "@/server/http";
import { CSRF_COOKIE, SESSION_COOKIE, parseCookies, revokeSession } from "@/server/session";
import { jwtVerify } from "jose";
import { env } from "@/server/env";

export const POST = route({}, async ({ req }) => {
  const jwt = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  try {
    const { payload } = await jwtVerify(jwt, new TextEncoder().encode(env().SESSION_SECRET));
    await revokeSession(String(payload.sid));
  } catch { /* already invalid */ }
  const res = json({ ok: true });
  res.headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0`);
  res.headers.append("set-cookie", `${CSRF_COOKIE}=; Path=/; Max-Age=0`);
  return res;
});
