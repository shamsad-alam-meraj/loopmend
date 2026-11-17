import { ok, readJson, route, searchParamsObject, validate } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { createPlanBody, planListQuery } from "@/lib/validation/recovery.schema";
import { createRecoveryPlan, listRecoveryPlans } from "@/services/recovery.service";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { requestId }) => {
  const { ctx } = await apiContext("incident:read", requestId);
  const q = validate(searchParamsObject(req), planListQuery);
  return ok(await listRecoveryPlans(ctx, q), requestId);
});

/** POST /api/v1/recovery-plans — honours an `Idempotency-Key` header for safe client retries. */
export const POST = route(
  async (req, { requestId }) => {
    const { ctx } = await apiContext("recovery:create", requestId);
    const body = await readJson(req, createPlanBody);
    const key = req.headers.get("idempotency-key")?.slice(0, 200) || undefined;
    const { plan, duplicate } = await createRecoveryPlan(ctx, { ...body, idempotencyKey: key });
    return ok({ plan, duplicate }, requestId, { status: duplicate ? 200 : 201 });
  },
  { name: "recovery:create", rateLimit: { capacity: 20, refillPerSecond: 0.5 } },
);
