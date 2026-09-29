import Link from "next/link";
import { requireCtx } from "@/server/auth";
import { homeData } from "@/server/services/dashboard";
import { hasRole } from "@/server/ctx";
import { PageHead, StatusBadge, fmtDate } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const d = await homeData(ctx);
  return (
    <>
      <PageHead title={`Welcome, ${ctx.name.split(" ")[0]}`} sub={`Signed in as ${ctx.roles.map((r) => ROLE_LABELS[r]).join(", ")}`} />
      {sp.denied ? <p role="alert" className="alert warn">You do not have access to that page with your role.</p> : null}
      <form action="/library" role="search" className="card" aria-label="Search instructions">
        <label className="field" htmlFor="q">Find an instruction</label>
        <div className="btn-row">
          <input id="q" name="q" type="search" className="input" style={{ flex: 1, minWidth: 220 }} placeholder="e.g. create purchase order, expense claim, lock out" />
          <button className="btn btn-primary" type="submit">Search</button>
        </div>
      </form>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        {d.acknowledgementsDue.length ? (
          <section className="card" aria-labelledby="ack"><h2 id="ack">Acknowledgements required</h2>
            <ul>{d.acknowledgementsDue.map((g) => <li key={g.guideId}><Link href={`/g/${g.documentId}`}>{g.title}</Link> <span className="badge warn">Acknowledge</span></li>)}</ul>
          </section>
        ) : null}
        <section className="card" aria-labelledby="fav"><h2 id="fav">Favourites</h2>
          {d.favourites.length ? <ul>{d.favourites.map((g) => <li key={g.id}><Link href={`/g/${g.documentId}`}>{g.title}</Link></li>)}</ul> : <p className="muted">No favourites yet. Open a guide and choose “Add to favourites”.</p>}
        </section>
        <section className="card" aria-labelledby="rec"><h2 id="rec">Recently viewed</h2>
          {d.recents.length ? <ul>{d.recents.map((g) => <li key={g.id}><Link href={`/g/${g.documentId}`}>{g.title}</Link></li>)}</ul> : <p className="muted">Guides you open will appear here.</p>}
        </section>

        {hasRole(ctx, "AUTHOR") ? (
          <section className="card" aria-labelledby="work"><h2 id="work">My work in progress</h2>
            {d.myWork.length ? (
              <ul>{d.myWork.map((v) => <li key={v.id}><Link href={`/guides/${v.guide.id}`}>{v.guide.documentId} · {v.guide.title}</Link> <StatusBadge status={v.status} /></li>)}</ul>
            ) : <p className="muted">Nothing in progress.</p>}
            <div className="btn-row"><Link className="btn btn-primary" href="/workspace">Open workspace</Link><Link className="btn" href="/captures">Record a process</Link><Link className="btn" href="/imports">Import a document</Link></div>
          </section>
        ) : null}

        {d.queue ? (
          <section className="card" aria-labelledby="q2"><h2 id="q2">Waiting for you</h2>
            <p>{d.queue.toReview.length} to review · {d.queue.toApprove.length} to approve · {d.queue.toPublish.length} to publish</p>
            <Link className="btn" href="/review">Open review queue</Link>
          </section>
        ) : null}

        {d.owner ? (
          <section className="card" aria-labelledby="own"><h2 id="own">My guides</h2>
            <p>{d.owner.rows.length} guides · <strong>{d.owner.overdue.length}</strong> overdue · {d.owner.dueSoon.length} due within 30 days · {d.owner.recommendations.length} open recommendation(s)</p>
            <Link className="btn" href="/dashboard">Owner dashboard</Link>
          </section>
        ) : null}

        <section className="card" aria-labelledby="not"><h2 id="not">Notifications</h2>
          {d.notifications.length ? <ul>{d.notifications.map((n) => <li key={n.id}>{n.link ? <Link href={n.link}>{n.message}</Link> : n.message} <span className="muted">{fmtDate(n.createdAt)}</span></li>)}</ul> : <p className="muted">You are up to date.</p>}
          <Link href="/notifications">All notifications</Link>
        </section>
      </div>
    </>
  );
}
