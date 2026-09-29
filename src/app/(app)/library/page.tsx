import Link from "next/link";
import { requireCtx } from "@/server/auth";
import { searchLibrary } from "@/server/services/search";
import { libraryFacets } from "@/server/services/dashboard";
import { PageHead, StatusBadge, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library" };

function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[\[|\]\])/);
  let on = false;
  return <>{parts.map((p, i) => (p === "[[" ? ((on = true), null) : p === "]]" ? ((on = false), null) : on ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}</>;
}

export default async function Library({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const filters = { siteId: sp.siteId || undefined, processCode: sp.processCode || undefined, ownerId: sp.ownerId || undefined, system: sp.system || undefined, category: sp.category || undefined, status: (sp.status as "PUBLISHED" | "UNDER_REVIEW") || undefined, reviewBefore: sp.reviewBefore || undefined };
  const facets = await libraryFacets(ctx);
  const result = q || Object.values(filters).some(Boolean) ? await searchLibrary(ctx, q || "*", filters).catch(() => ({ hits: [], relaxed: false, expanded: [] })) : null;
  // Browse mode: no query -> list all live guides (filtered)
  let browse: { documentId: string; title: string; status: string; reviewDate: Date | null; systems: string[] }[] = [];
  if (!q) {
    const { prisma } = await import("@/server/db");
    const { guideScope } = await import("@/server/authz");
    const guides = await prisma.guide.findMany({
      where: { AND: [guideScope(ctx), { liveVersionId: { not: null }, archivedAt: null }, filters.siteId ? { siteId: filters.siteId } : {}, filters.processCode ? { processCode: filters.processCode } : {}, filters.ownerId ? { ownerId: filters.ownerId } : {}, filters.system ? { systems: { has: filters.system } } : {}, filters.category ? { categories: { has: filters.category } } : {}] },
      orderBy: { title: "asc" }, take: 100,
    });
    const versions = await prisma.guideVersion.findMany({ where: { id: { in: guides.map((g) => g.liveVersionId!) } } });
    browse = guides.map((g) => { const v = versions.find((x) => x.id === g.liveVersionId)!; return { documentId: g.documentId, title: g.title, status: v.status, reviewDate: v.reviewDate, systems: g.systems }; }).filter((g) => !filters.status || g.status === filters.status);
  }
  const Sel = ({ name, label, options }: { name: string; label: string; options: { value: string; label: string }[] }) => (
    <label className="field" style={{ margin: 0 }}>{label}
      <select name={name} defaultValue={sp[name] ?? ""}><option value="">Any</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </label>
  );
  return (
    <>
      <PageHead title="Library" sub="Published, approved instructions you are authorised to see. Drafts never appear here." />
      <form method="get" role="search" className="card" aria-label="Search and filter">
        <label className="field" htmlFor="q">Search titles, metadata and steps</label>
        <div className="btn-row" style={{ marginBottom: 12 }}>
          <input id="q" name="q" type="search" className="input" defaultValue={q} style={{ flex: 1, minWidth: 220 }} />
          <button className="btn btn-primary" type="submit">Search</button>
        </div>
        <div className="grid cols-3">
          <Sel name="siteId" label="Site" options={facets.sites.map((s) => ({ value: s.id, label: s.name }))} />
          <Sel name="processCode" label="Process" options={facets.processes.map((p) => ({ value: p, label: p }))} />
          <Sel name="ownerId" label="Owner" options={facets.owners.map((o) => ({ value: o.id, label: o.name }))} />
          <Sel name="system" label="System" options={facets.systems.map((p) => ({ value: p, label: p }))} />
          <Sel name="category" label="Category" options={facets.categories.map((p) => ({ value: p, label: p }))} />
          <Sel name="status" label="Status" options={[{ value: "PUBLISHED", label: "Published" }, { value: "UNDER_REVIEW", label: "Under review" }]} />
        </div>
      </form>
      <section aria-live="polite" style={{ marginTop: 16 }}>
        {q && result ? (
          <>
            <h2>{result.hits.length} result{result.hits.length === 1 ? "" : "s"} for “{q}”</h2>
            {result.expanded.length ? <p className="muted">Also matched related terms: {result.expanded.slice(0, 8).join(", ")}</p> : null}
            {result.relaxed ? <p className="alert info">No guide matched every word, so partial matches are shown.</p> : null}
            {result.hits.length === 0 ? <p className="card">No published instruction matched. Try fewer or different words, or <Link href={`/ask?q=${encodeURIComponent(q)}`}>ask the assistant</Link>. This search has been recorded (without your name) so gaps in the library can be found.</p> : null}
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
              {result.hits.map((h) => (
                <li key={h.guideId} className="card">
                  <h3 style={{ margin: 0 }}><Link href={`/g/${h.documentId}${h.stepId ? `#step-${h.stepId}` : ""}`}>{h.title}</Link> <StatusBadge status={h.status} /></h3>
                  <p style={{ margin: "4px 0" }}><Snippet text={h.snippet} /></p>
                  <p className="muted" style={{ margin: 0 }}>{h.documentId} · v{h.versionLabel}{h.siteName ? ` · ${h.siteName}` : ""}{h.ownerName ? ` · Owner: ${h.ownerName}` : ""} · Review due {fmtDate(h.reviewDate)}</p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h2>{browse.length} published guide{browse.length === 1 ? "" : "s"}</h2>
            {browse.length === 0 ? <p className="card muted">No published guides match these filters.</p> : (
              <div className="table-wrap"><table className="table"><caption className="visually-hidden">Published guides</caption><thead><tr><th scope="col">Guide</th><th scope="col">ID</th><th scope="col">Status</th><th scope="col">Systems</th><th scope="col">Review due</th></tr></thead><tbody>
                {browse.map((g) => <tr key={g.documentId}><td><Link href={`/g/${g.documentId}`}>{g.title}</Link></td><td>{g.documentId}</td><td><StatusBadge status={g.status} /></td><td>{g.systems.join(", ") || "—"}</td><td>{fmtDate(g.reviewDate)}</td></tr>)}
              </tbody></table></div>
            )}
          </>
        )}
      </section>
    </>
  );
}
