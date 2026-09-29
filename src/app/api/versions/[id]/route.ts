import { route } from "@/server/http";
import { getVersionDetail } from "@/server/services/guides";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => getVersionDetail(ctx, params.id));
