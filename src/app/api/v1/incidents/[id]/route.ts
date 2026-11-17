import { ok, readJson, route } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { incidentUpdateBody } from "@/lib/validation/query.schema";
import { getIncident, updateIncident } from "@/services/incident.service";

export const dynamic = "force-dynamic";
type Ctx = RouteContext<"/api/v1/incidents/[id]">;

export const GET = route<Ctx>(async (_req, { params, requestId }) => {
  const { ctx } = await apiContext("incident:read", requestId);
  const { id } = await params;
  return ok(await getIncident(ctx, id), requestId);
});

/** PATCH { action?: acknowledge|resolve|dismiss|reopen|assign_self|unassign, severity?, note? } */
export const PATCH = route<Ctx>(
  async (req, { params, requestId }) => {
    const { ctx } = await apiContext("incident:update", requestId);
    const { id } = await params;
    const body = await readJson(req, incidentUpdateBody);
    return ok(await updateIncident(ctx, id, body), requestId);
  },
  { rateLimit: { capacity: 30, refillPerSecond: 1 } },
);
