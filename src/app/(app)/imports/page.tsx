import Link from "next/link";
import { requireRole } from "@/server/auth";
import { listImports } from "@/server/services/imports";
import { prisma } from "@/server/db";
import { PageHead, Empty, fmtDateTime } from "@/components/ui";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import legacy instructions" };

export default async function Imports() {
  const ctx = await requireRole("AUTHOR");
  const [{ batches, items }, templates] = await Promise.all([listImports(ctx), prisma.template.findMany({ where: { orgId: ctx.orgId, active: true }, select: { key: true, name: true } })]);
  return (
    <>
      <PageHead title="Import legacy instructions" sub="Rebuild Word, PDF, PowerPoint, HTML, Markdown and scanned documents into governed, structured drafts. Originals are preserved untouched; nothing is published until a person has confirmed and approved it." />
      <UploadForm templates={templates} />
      <h2>Batches</h2>
      {batches.length === 0 ? <Empty>No imports yet.</Empty> : (
        <div className="table-wrap"><table className="table"><caption className="visually-hidden">Import batches</caption><thead><tr><th scope="col">Batch</th><th scope="col">Created</th><th scope="col">Mode</th><th scope="col">Status</th></tr></thead><tbody>
          {batches.map((b) => <tr key={b.id}><td><Link href={`/imports/batches/${b.id}`}>{b.name}</Link></td><td>{fmtDateTime(b.createdAt)}</td><td>{b.dryRun ? "Dry run" : "Live"}</td><td>{b.status.toLowerCase()}</td></tr>)}
        </tbody></table></div>
      )}
      <h2>Recent files</h2>
      {items.length === 0 ? <Empty>No files yet.</Empty> : (
        <div className="table-wrap"><table className="table"><thead><tr><th scope="col">File</th><th scope="col">Status</th><th scope="col">Added</th><th scope="col"><span className="visually-hidden">Open</span></th></tr></thead><tbody>
          {items.map((i) => <tr key={i.id}><td>{i.filename}</td><td>{i.status.replaceAll("_", " ").toLowerCase()}</td><td>{fmtDateTime(i.createdAt)}</td><td><Link href={`/imports/${i.id}`}>Review</Link></td></tr>)}
        </tbody></table></div>
      )}
    </>
  );
}
