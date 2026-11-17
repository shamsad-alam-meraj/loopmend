import { ok, route } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { investigateIncident } from "@/services/investigation.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/v1/incidents/:id/investigate — runs classification + investigation and persists the validated result. */
export const POST = route<RouteContext<"/api/v1/incidents/[id]/investigate">>(
  async (_req, { params, requestId }) => {
    const { ctx } = await apiContext("incident:investigate", requestId);
    const inv = await investigateIncident(ctx, (await params).id);
    return ok({ investigationId: inv.id, status: inv.status, provider: inv.provider, model: inv.model, usedFallback: inv.usedFallback, diagnosis: inv.diagnosis }, requestId, { status: 201 });
  },
  { name: "investigate", rateLimit: { capacity: 10, refillPerSecond: 0.2 } },
);
