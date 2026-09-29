import { route } from "@/server/http";
import { getBatch } from "@/server/services/imports";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => getBatch(ctx, params.id));
