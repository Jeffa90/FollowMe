import Link from "next/link";
import { requireCtx } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHead, Empty, fmtDateTime } from "@/components/ui";
import { MarkRead } from "./MarkRead";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };
export default async function Notifications() {
  const ctx = await requireCtx();
  const items = await prisma.notification.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <PageHead title="Notifications"><MarkRead disabled={!items.some((i) => !i.readAt)} /></PageHead>
      {items.length === 0 ? <Empty>Nothing yet.</Empty> : <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>{items.map((n) => <li key={n.id} className="card" style={{ opacity: n.readAt ? 0.7 : 1 }}>{n.link ? <Link href={n.link}>{n.message}</Link> : n.message} <span className="muted">{fmtDateTime(n.createdAt)}</span>{n.readAt ? null : <span className="badge info" style={{ marginLeft: 6 }}>new</span>}</li>)}</ul>}
    </>
  );
}
