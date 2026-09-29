import { route } from "@/server/http";
export const GET = route({ allowToken: true }, async ({ ctx }) => ({ userId: ctx.userId, name: ctx.name, email: ctx.email, roles: ctx.roles, orgId: ctx.orgId, via: ctx.via }));
