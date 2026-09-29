import { requireRole } from "@/server/auth";
import { getSettings, listRegistry, listUsers } from "@/server/services/admin";
import { prisma } from "@/server/db";
import { PageHead } from "@/components/ui";
import { AdminClient } from "./AdminClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administration" };
export default async function Admin() {
  const ctx = await requireRole("ADMIN");
  const [users, settings, reg, teams, sites] = await Promise.all([listUsers(ctx), getSettings(ctx), listRegistry(ctx), prisma.team.findMany({ where: { orgId: ctx.orgId } }), prisma.site.findMany({ where: { orgId: ctx.orgId } })]);
  return (
    <>
      <PageHead title="Administration" sub="Users and roles, AI and capture policy, retention, taxonomy, retired references, templates, webhooks and API tokens. Every change is audited." />
      <AdminClient
        users={JSON.parse(JSON.stringify(users))} settings={JSON.parse(JSON.stringify(settings))} teams={teams.map((t) => ({ id: t.id, name: t.name }))} sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        registry={JSON.parse(JSON.stringify({ synonyms: reg.synonyms, retired: reg.retired, taxonomy: reg.taxonomy, workflows: reg.workflows.map((w) => ({ id: w.id, name: w.name, stages: w.stages, reviewMin: w.reviewMin, isDefault: w.isDefault })), templates: reg.templates.map((t) => ({ id: t.id, key: t.key, name: t.name, definition: t.definition })), tokens: reg.tokens, webhooks: reg.webhooks }))} />
    </>
  );
}
