import { requireCtx } from "@/server/auth";
import { PageHead } from "@/components/ui";
import { AskForm } from "./AskForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask" };
export default async function Ask({ searchParams }: { searchParams: Promise<{ q?: string; guide?: string }> }) {
  await requireCtx();
  const sp = await searchParams;
  return (
    <>
      <PageHead title="Ask the assistant" sub="Answers come only from approved, published guides you are authorised to see, and always cite the guide and step. If there is no approved answer, it says so." />
      <AskForm initialQuestion={sp.q ?? ""} documentId={sp.guide} />
    </>
  );
}
