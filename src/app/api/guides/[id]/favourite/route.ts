import { route } from "@/server/http";
import { toggleFavourite } from "@/server/services/library";
export const POST = route<{ id: string }>({}, async ({ ctx, params }) => toggleFavourite(ctx, params.id));
