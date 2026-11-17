import { ok, route } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { executeRecoveryPlan } from "@/services/recovery.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/v1/recovery-plans/:id/execute — one idempotent attempt of an approved plan. */
export const POST = route<RouteContext<"/api/v1/recovery-plans/[id]/execute">>(
  async (_req, { params, requestId }) => {
    const { ctx } = await apiContext("recovery:execute", requestId);
    const out = await executeRecoveryPlan(ctx, (await params).id);
    return ok({ planStatus: out.plan.status, attempt: out.attempt, duplicate: out.duplicate, result: out.result }, requestId, { status: out.duplicate ? 200 : 202 });
  },
  { name: "recovery:execute", rateLimit: { capacity: 10, refillPerSecond: 0.3 } },
);
