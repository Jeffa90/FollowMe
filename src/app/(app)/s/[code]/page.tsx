import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { resolveShortCode } from "@/server/services/library";

export const dynamic = "force-dynamic";
export default async function Short({ params }: { params: Promise<{ code: string }> }) {
  const ctx = await requireCtx();
  const { code } = await params;
  const doc = await resolveShortCode(ctx, code).catch(() => null);
  if (!doc) notFound();
  redirect(`/g/${doc}`);
}
