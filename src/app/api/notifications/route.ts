import { z } from "zod";
import { prisma } from "@/server/db";
import { parseBody, route } from "@/server/http";
export const GET = route({}, async ({ ctx }) => ({ items: await prisma.notification.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 100 }) }));
export const POST = route({}, async ({ ctx, req }) => { await parseBody(req, z.object({ action: z.literal("mark_all_read") })); await prisma.notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } }); return { ok: true }; });
