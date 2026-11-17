import { ok, route, searchParamsObject, validate } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { executionListQuery } from "@/lib/validation/query.schema";
import { listExecutions } from "@/services/workflow.service";

export const dynamic = "force-dynamic";

/** GET /api/v1/workflows/:id/executions?status=error,success&cursor=&limit= */
export const GET = route<RouteContext<"/api/v1/workflows/[id]/executions">>(async (req, { params, requestId }) => {
  const { ctx } = await apiContext("dashboard:read", requestId);
  const q = validate(searchParamsObject(req), executionListQuery);
  const { items, nextCursor } = await listExecutions(ctx, (await params).id, q);
  return ok(items, requestId, { meta: { nextCursor } });
});
