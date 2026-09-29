import { route } from "@/server/http";
import { runScanNow } from "@/server/services/admin";
export const POST = route({ limit: [5, 60_000] }, async ({ ctx }) => runScanNow(ctx));
