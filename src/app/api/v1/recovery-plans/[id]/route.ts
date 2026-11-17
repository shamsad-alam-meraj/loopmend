import { ok, route } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { getRecoveryPlan } from "@/services/recovery.service";

export const dynamic = "force-dynamic";

export const GET = route<RouteContext<"/api/v1/recovery-plans/[id]">>(async (_req, { params, requestId }) => {
  const { ctx } = await apiContext("incident:read", requestId);
  return ok(await getRecoveryPlan(ctx, (await params).id), requestId);
});
