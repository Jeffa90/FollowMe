import Link from "next/link";
import { requireCtx } from "@/server/auth";
import { hasRole } from "@/server/ctx";
import { listMaps } from "@/server/services/maps";
import { PageHead, Empty, fmtDate } from "@/components/ui";
import { NewMap } from "./NewMap";

export const dynamic = "force-dynamic";
export const metadata = { title: "Process maps" };
export default async function Maps() {
  const ctx = await requireCtx();
  const maps = await listMaps(ctx);
  return (
    <>
      <PageHead title="Process maps" sub="End-to-end processes assembled from published task guides: triggers, inputs and outputs, roles, handoffs, decisions, exceptions and controls." />
      {hasRole(ctx, "AUTHOR", "PROCESS_OWNER") ? <NewMap /> : null}
      {maps.length === 0 ? <Empty>No process maps yet.</Empty> : <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>{maps.map((m) => <li key={m.id} className="card"><Link href={`/maps/${m.id}`}>{m.title}</Link> <span className={`badge ${m.status === "PUBLISHED" ? "ok" : "neutral"}`}>{m.status.toLowerCase()}</span> <span className="muted">updated {fmtDate(m.updatedAt)}</span></li>)}</ul>}
    </>
  );
}
