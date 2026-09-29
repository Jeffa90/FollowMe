import { parseBody, route } from "@/server/http";
import { z } from "zod";
import { listFeedback, setFeedbackStatus, submitFeedback } from "@/server/services/library";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => ({ items: await listFeedback(ctx, params.id) }));
export const POST = route<{ id: string }>({ limit: [30, 60_000] }, async ({ ctx, req, params }) => submitFeedback(ctx, params.id, await req.json()));
export const PATCH = route<{ id: string }>({}, async ({ ctx, req }) => {
  const b = await parseBody(req, z.object({ feedbackId: z.string(), status: z.enum(["ACKNOWLEDGED", "RESOLVED"]) }));
  await setFeedbackStatus(ctx, b.feedbackId, b.status);
  return { ok: true };
});
