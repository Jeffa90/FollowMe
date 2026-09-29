import Link from "next/link";
import { requireRole } from "@/server/auth";
import { listWorkspace } from "@/server/services/guides";
import { prisma } from "@/server/db";
import { PageHead, StatusBadge, fmtDate, Empty } from "@/components/ui";
import { NewGuideForm } from "./NewGuideForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workspace" };

export default async function Workspace() {
  const ctx = await requireRole("AUTHOR");
  const [items, templates] = await Promise.all([listWorkspace(ctx), prisma.template.findMany({ where: { orgId: ctx.orgId, active: true }, orderBy: { name: "asc" } })]);
  return (
    <>
      <PageHead title="Workspace" sub="Drafts and guides in progress. Nothing here is visible to learners until it is approved and published.">
        <Link className="btn" href="/captures">Record a process</Link><Link className="btn" href="/imports">Import a document</Link>
      </PageHead>
      <NewGuideForm templates={templates.map((t) => ({ key: t.key, name: t.name, description: t.description }))} />
      <h2>In progress</h2>
      {items.length === 0 ? <Empty>No guides in progress. Create one above, record a process or import a legacy document.</Empty> : (
        <div className="table-wrap"><table className="table"><caption className="visually-hidden">Guides in progress</caption><thead><tr><th scope="col">Guide</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Source</th><th scope="col">Updated</th></tr></thead><tbody>
          {items.map((v) => <tr key={v.id}><td><Link href={`/guides/${v.guide.id}`}>{v.guide.documentId} · {v.guide.title}</Link></td><td>{v.label}</td><td><StatusBadge status={v.status} /></td><td>{v.source.toLowerCase().replace("_", " ")}</td><td>{fmtDate(v.updatedAt)}</td></tr>)}
        </tbody></table></div>
      )}
    </>
  );
}
