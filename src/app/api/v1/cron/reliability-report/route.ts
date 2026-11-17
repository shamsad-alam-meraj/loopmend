import { ok, route } from "@/lib/http/api";
import { assertCron } from "@/lib/http/cron";
import { getDb } from "@/lib/db/client";
import { organizations } from "@schema";
import { systemContext } from "@/services/context";
import { reliabilityReport } from "@/services/reliability.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Used by the n8n "reliability-reporter" schedule to post periodic summaries (e.g. to Slack). */
export const GET = route(async (req, { requestId }) => {
  assertCron(req);
  const db = await getDb();
  const orgs = await db.select().from(organizations);
  const reports = [];
  for (const org of orgs) {
    const r = await reliabilityReport(systemContext(org.id, requestId), 1);
    reports.push({
      organization: { id: org.id, name: org.name },
      successRate: r.summary.successRate,
      executions: r.summary.runs,
      failures: r.summary.failures,
      p95Ms: r.summary.p95Ms,
      mttrMs: r.response.mttrMs,
      recoverySuccessRate: r.recovery.planSuccessRate,
      anomalies: r.anomalies.flatMap((a) => a.anomalies.map((x) => `${a.workflowName}: ${x.message}`)),
      sloBreaches: r.workflows.filter((w) => w.slo.remaining === 0 && w.runs > 0).map((w) => w.name),
    });
  }
  return ok(reports, requestId);
});
