import { ok, route } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { listInvestigations } from "@/services/investigation.service";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { requestId }) => {
  const { ctx } = await apiContext("incident:read", requestId);
  const incidentId = req.nextUrl.searchParams.get("incidentId") ?? undefined;
  return ok(await listInvestigations(ctx, { incidentId: incidentId && /^[0-9a-f-]{36}$/i.test(incidentId) ? incidentId : undefined }), requestId);
});
