import { route } from "@/server/http";
import { listVersions, loadGuide } from "@/server/services/guides";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) => {
  const guide = await loadGuide(ctx, params.id);
  return { guide, versions: await listVersions(ctx, guide.id) };
});
