import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { createWebhook } from "@/server/services/webhooks";
export const POST = route({}, async ({ ctx, req }) => createWebhook(ctx, await parseBody(req, z.unknown())));
