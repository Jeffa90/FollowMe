"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "./api";

export function Nav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {items.map((i) => {
        const current = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return <Link key={i.href} href={i.href} aria-current={current ? "page" : undefined}>{i.label}</Link>;
      })}
    </nav>
  );
}
export function LogoutButton() {
  return <button className="btn btn-sm" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>Sign out</button>;
}
