import { route } from "@/server/http";
import { getCapturePolicy } from "@/server/services/capture";
import { requireScope } from "@/server/session";
export const GET = route({ allowToken: true }, async ({ ctx }) => { requireScope(ctx, "capture"); return getCapturePolicy(ctx); });
