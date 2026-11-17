import { ok, route } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { listAuditLogs } from "@/services/audit.service";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { requestId }) => {
  const { ctx } = await apiContext("audit:read", requestId);
  const sp = req.nextUrl.searchParams;
  const before = sp.get("before");
  const targetId = sp.get("targetId") ?? undefined;
  return ok(await listAuditLogs(ctx, { limit: Number(sp.get("limit") ?? 50) || 50, before: before ? new Date(before) : undefined, targetId }), requestId);
});
