import { route } from "@/server/http";
import { listSessions, startSession } from "@/server/services/capture";
import { requireScope } from "@/server/session";
export const GET = route({}, async ({ ctx }) => ({ items: await listSessions(ctx) }));
export const POST = route({ allowToken: true, limit: [30, 60_000] }, async ({ ctx, req }) => {
  requireScope(ctx, "capture");
  const s = await startSession(ctx, await req.json().catch(() => ({})));
  return { id: s.id, status: s.status };
});
