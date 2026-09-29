import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { issueApiToken } from "@/server/session";
import { forbidden } from "@/server/errors";
import { audit } from "@/server/audit";

// Scoped, revocable token for the browser extension. Only obtainable from an interactive session.
export const POST = route({ limit: [10, 60_000] }, async ({ ctx, req }) => {
  if (ctx.via !== "session") throw forbidden("Tokens can only be issued from a signed-in session");
  const { name, scopes, days } = await parseBody(req, z.object({ name: z.string().min(1).max(80), scopes: z.array(z.enum(["capture"])).min(1), days: z.number().int().min(1).max(90).default(30) }));
  const t = await issueApiToken(ctx, name, scopes, days);
  await audit(ctx, null, { action: "API_TOKEN_ISSUED", entityType: "ApiToken", entityId: t.id, summary: `Issued capture token "${name}"`, detail: { scopes, days } });
  return t;
});
