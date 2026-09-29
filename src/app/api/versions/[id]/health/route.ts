import { route } from "@/server/http";
import { assess, runHealth } from "@/server/services/health";
import { getVersionDetail } from "@/server/services/guides";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => {
  await getVersionDetail(ctx, params.id);
  const findings = await runHealth(ctx.orgId, params.id);
  return { findings, assessment: assess(findings) };
});
