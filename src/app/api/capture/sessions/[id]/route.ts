import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { discardSession, getSession, setSessionStatus } from "@/server/services/capture";
import { requireScope } from "@/server/session";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => getSession(ctx, params.id));
export const PATCH = route<{ id: string }>({ allowToken: true }, async ({ ctx, req, params }) => {
  requireScope(ctx, "capture");
  const b = await parseBody(req, z.object({ status: z.enum(["RECORDING", "PAUSED", "STOPPED"]) }));
  const s = await setSessionStatus(ctx, params.id, b.status);
  return { id: s.id, status: s.status, eventCount: s.eventCount };
});
export const DELETE = route<{ id: string }>({}, async ({ ctx, params }) => { await discardSession(ctx, params.id); return { ok: true }; });
