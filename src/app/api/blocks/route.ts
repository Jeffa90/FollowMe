import { parseBody, route } from "@/server/http";
import { createBlock, listBlocks } from "@/server/services/blocks";
import { z } from "zod";
export const GET = route({}, async ({ ctx }) => ({ items: await listBlocks(ctx) }));
export const POST = route({}, async ({ ctx, req }) => createBlock(ctx, await parseBody(req, z.unknown())));
