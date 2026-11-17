import { ok, route } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { listWorkflows } from "@/services/workflow.service";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { requestId }) => {
  const { ctx } = await apiContext("dashboard:read", requestId);
  const hours = Math.min(24 * 30, Math.max(1, Number(req.nextUrl.searchParams.get("windowHours") ?? 24) || 24));
  return ok(await listWorkflows(ctx, { windowHours: hours }), requestId);
});
