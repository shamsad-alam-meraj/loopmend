import { ok, route, searchParamsObject, validate } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { incidentListQuery } from "@/lib/validation/query.schema";
import { listIncidents } from "@/services/incident.service";

export const dynamic = "force-dynamic";

/** GET /api/v1/incidents?view=active|closed|all|dead_letter&status=&severity=&category=&workflowId=&q=&cursor=&limit= */
export const GET = route(async (req, { requestId }) => {
  const { ctx } = await apiContext("incident:read", requestId);
  const query = validate(searchParamsObject(req), incidentListQuery);
  const { items, nextCursor } = await listIncidents(ctx, query);
  return ok(items, requestId, { meta: { nextCursor } });
});
