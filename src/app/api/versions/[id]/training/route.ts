import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { acknowledge, markRead, quizForLearner, signoff, submitQuiz } from "@/server/services/training";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => ({ quiz: await quizForLearner(ctx, params.id) }));
export const POST = route<{ id: string }>({}, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ action: z.enum(["read", "acknowledge", "quiz", "signoff"]) }).passthrough());
  if (b.action === "read") return markRead(ctx, params.id);
  if (b.action === "acknowledge") return acknowledge(ctx, params.id);
  if (b.action === "quiz") return submitQuiz(ctx, params.id, b);
  return signoff(ctx, params.id, b);
});
