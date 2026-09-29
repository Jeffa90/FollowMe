import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { blockImpact, reviseBlock } from "@/server/services/blocks";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => blockImpact(ctx, params.id));
export const PUT = route<{ id: string }>({}, async ({ ctx, req, params }) => reviseBlock(ctx, params.id, await parseBody(req, z.unknown())));
