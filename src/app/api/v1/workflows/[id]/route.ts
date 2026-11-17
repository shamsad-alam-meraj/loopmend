import { ok, readJson, route } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { workflowUpdateBody } from "@/lib/validation/query.schema";
import { getWorkflow, updateWorkflowSettings } from "@/services/workflow.service";

export const dynamic = "force-dynamic";
type Ctx = RouteContext<"/api/v1/workflows/[id]">;

export const GET = route<Ctx>(async (_req, { params, requestId }) => {
  const { ctx } = await apiContext("dashboard:read", requestId);
  return ok(await getWorkflow(ctx, (await params).id), requestId);
});

export const PATCH = route<Ctx>(async (req, { params, requestId }) => {
  const { ctx } = await apiContext("workflow:manage", requestId);
  const body = await readJson(req, workflowUpdateBody);
  return ok(await updateWorkflowSettings(ctx, (await params).id, body), requestId);
});
