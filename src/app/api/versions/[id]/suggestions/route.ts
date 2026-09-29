import { route } from "@/server/http";
import { listSuggestions } from "@/server/services/suggestions";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => ({ items: await listSuggestions(ctx, params.id) }));
