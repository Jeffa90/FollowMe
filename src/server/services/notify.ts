import { prisma, Db } from "../db";

/** In-app notifications. Email/Teams delivery is an adapter concern (docs/02-architecture/integrations.md). */
export async function notify(orgId: string, userIds: (string | null | undefined)[], kind: string, message: string, link?: string, db: Db = prisma) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await db.notification.createMany({ data: ids.map((userId) => ({ orgId, userId, kind, message, link })) });
}

export async function usersWithRole(orgId: string, role: string, db: Db = prisma) {
  const u = await db.user.findMany({ where: { orgId, active: true, roles: { has: role as never } }, select: { id: true } });
  return u.map((x) => x.id);
}
