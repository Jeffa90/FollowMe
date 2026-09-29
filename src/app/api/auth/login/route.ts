import { z } from "zod";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { json, parseBody, route } from "@/server/http";
import { CSRF_COOKIE, SESSION_COOKIE, cookieAttrs, createSession } from "@/server/session";
import { audit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";

// Local role simulation only. Production uses the Entra ID OIDC adapter (docs/02-architecture/integrations.md).
export const POST = route({ public: true, limit: [20, 60_000] }, async ({ req, ip }) => {
  if (env().AUTH_MODE !== "local") throw notFound();
  const { email } = await parseBody(req, z.object({ email: z.string().email().max(200), org: z.string().max(60).optional() }));
  const user = await prisma.user.findFirst({ where: { email: email.toLowerCase(), active: true } });
  if (!user) throw new AppError(401, "unauthorized", "Unknown or inactive user");
  const s = await createSession(user.id, ip);
  await audit({ orgId: user.orgId, userId: user.id, name: user.name, ip }, null, { action: "LOGIN", entityType: "User", entityId: user.id, summary: `${user.name} signed in (local simulation)` });
  const res = json({ ok: true, user: { id: user.id, name: user.name, roles: user.roles } });
  res.headers.append("set-cookie", `${SESSION_COOKIE}=${s.jwt}; ${cookieAttrs(s.expiresAt, true)}`);
  res.headers.append("set-cookie", `${CSRF_COOKIE}=${s.csrf}; ${cookieAttrs(s.expiresAt, false)}`);
  return res;
});
