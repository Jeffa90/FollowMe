import { requireRole } from "@/server/auth";
import { listBlocks } from "@/server/services/blocks";
import { PageHead } from "@/components/ui";
import { BlocksClient } from "./BlocksClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reusable blocks" };
export default async function Blocks() {
  await requireRole("AUTHOR", "PROCESS_OWNER", "ADMIN");
  const blocks = await listBlocks(await (await import("@/server/auth")).requireCtx());
  return (
    <>
      <PageHead title="Reusable blocks" sub="Governed standard content (warnings, safety controls, privacy notices, escalation details). Changing a block shows every affected guide first; published guides keep their approved wording until re-approved." />
      <BlocksClient blocks={blocks.map((b) => ({ id: b.id, key: b.key, kind: b.kind, title: b.title, body: b.body, version: b.version, requiresReapproval: b.requiresReapproval }))} />
    </>
  );
}
