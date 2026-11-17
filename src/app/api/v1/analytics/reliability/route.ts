import { ok, route } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { reliabilityReport } from "@/services/reliability.service";

export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/reliability?days=7 — SLOs, error budgets, MTTR, recovery success, anomalies. */
export const GET = route(async (req, { requestId }) => {
  const { ctx } = await apiContext("dashboard:read", requestId);
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 7) || 7));
  return ok(await reliabilityReport(ctx, days), requestId);
});
