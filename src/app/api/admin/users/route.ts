import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { listUsers, updateUser } from "@/server/services/admin";
export const GET = route({}, async ({ ctx }) => ({ items: await listUsers(ctx) }));
export const PATCH = route({}, async ({ ctx, req }) => { const b = await parseBody(req, z.object({ userId: z.string() }).passthrough()); const { userId, ...rest } = b; return updateUser(ctx, userId, rest); });
