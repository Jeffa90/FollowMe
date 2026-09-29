import Link from "next/link";
import { requireCtx } from "@/server/auth";
import { hasRole } from "@/server/ctx";
import { Nav, LogoutButton } from "@/components/Nav";
import { prisma } from "@/server/db";
import { ROLE_LABELS } from "@/lib/roles";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const unread = await prisma.notification.count({ where: { userId: ctx.userId, readAt: null } });
  const items = [{ href: "/", label: "Home" }, { href: "/library", label: "Library" }, { href: "/ask", label: "Ask" }];
  if (hasRole(ctx, "AUTHOR")) items.push({ href: "/workspace", label: "Workspace" }, { href: "/captures", label: "Capture" }, { href: "/imports", label: "Import" });
  if (hasRole(ctx, "REVIEWER", "APPROVER", "PUBLISHER")) items.push({ href: "/review", label: "Review queue" });
  if (hasRole(ctx, "PROCESS_OWNER", "ADMIN", "PUBLISHER", "AUDITOR")) items.push({ href: "/dashboard", label: "Owners & reviews" });
  if (hasRole(ctx, "PROCESS_OWNER", "ADMIN", "AUDITOR", "PUBLISHER")) items.push({ href: "/analytics", label: "Analytics" });
  if (hasRole(ctx, "AUTHOR", "PROCESS_OWNER", "ADMIN")) items.push({ href: "/blocks", label: "Reusable blocks" });
  items.push({ href: "/training", label: "Training" });
  if (hasRole(ctx, "ADMIN")) items.push({ href: "/admin", label: "Admin" });
  if (hasRole(ctx, "ADMIN", "AUDITOR")) items.push({ href: "/audit", label: "Audit" });
  return (
    <>
      <header className="app-header">
        <div className="inner">
          <Link className="brand" href="/">FollowMe</Link>
          <Nav items={items} />
          <div className="userbox">
            <Link href="/notifications" aria-label={`Notifications, ${unread} unread`}>🔔 {unread}</Link>
            <span>{ctx.name} <span className="muted">({ctx.roles.map((r) => ROLE_LABELS[r]).join(", ")})</span></span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
