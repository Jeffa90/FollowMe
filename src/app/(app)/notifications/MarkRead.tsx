"use client";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
export function MarkRead({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  return <button className="btn" disabled={disabled} onClick={async () => { await api("/api/notifications", { body: { action: "mark_all_read" } }); router.refresh(); }}>Mark all as read</button>;
}
