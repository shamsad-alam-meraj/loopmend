import { ok, readJson, route } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { decisionBody } from "@/lib/validation/recovery.schema";
import { decideRecoveryPlan } from "@/services/recovery.service";

export const dynamic = "force-dynamic";

/** POST /api/v1/recovery-plans/:id/approve { comment? } */
export const POST = route<RouteContext<"/api/v1/recovery-plans/[id]/approve">>(
  async (req, { params, requestId }) => {
    const { ctx } = await apiContext("recovery:approve", requestId);
    const { comment } = await readJson(req, decisionBody);
    return ok(await decideRecoveryPlan(ctx, (await params).id, "approved", comment), requestId);
  },
  { name: "recovery:decide", rateLimit: { capacity: 20, refillPerSecond: 0.5 } },
);
