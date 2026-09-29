import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { json, route } from "@/server/http";
import { notFound } from "@/server/errors";

export const GET = route({ public: true }, async () => {
  if (env().AUTH_MODE !== "local") throw notFound();
  const users = await prisma.user.findMany({ where: { active: true }, select: { email: true, name: true, roles: true, jobTitle: true }, orderBy: { name: "asc" } });
  return json({ users });
});
