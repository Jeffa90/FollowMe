import { route } from "@/server/http";
import { exceptionReportCsv } from "@/server/services/imports";
export const GET = route<{ id: string }>({}, async ({ ctx, params }) =>
  new Response(await exceptionReportCsv(ctx, params.id), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="import-exceptions-${params.id}.csv"` } }));
