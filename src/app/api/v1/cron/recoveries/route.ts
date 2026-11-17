import "@/services/hooks";
import { ok, route } from "@/lib/http/api";
import { assertCron } from "@/lib/http/cron";
import { processDueRecoveries } from "@/services/recovery.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scheduled: runs due backoff retries, dead-letters expired plans and ambiguous attempts. */
export const GET = route(async (req, { requestId }) => {
  assertCron(req);
  return ok(await processDueRecoveries(), requestId);
});
export const POST = GET;
