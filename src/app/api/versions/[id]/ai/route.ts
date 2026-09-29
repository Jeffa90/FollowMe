import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { runSuggestionTask, TASKS } from "@/server/ai/tasks";
export const POST = route<{ id: string }>({ limit: [20, 60_000] }, async ({ ctx, req, params }) => {
  const b = await parseBody(req, z.object({ task: z.enum(TASKS), stepId: z.string().optional(), language: z.string().max(40).optional() }));
  return runSuggestionTask(ctx, params.id, b.task, { stepId: b.stepId, language: b.language });
});
