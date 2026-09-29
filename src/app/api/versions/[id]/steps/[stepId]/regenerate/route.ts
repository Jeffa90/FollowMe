import { route } from "@/server/http";
import { regenerateStep } from "@/server/services/capture";
export const POST = route<{ id: string; stepId: string }>({}, async ({ ctx, params }) => regenerateStep(ctx, params.id, params.stepId));
