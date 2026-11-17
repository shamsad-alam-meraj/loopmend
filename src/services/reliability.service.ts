import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { executions, incidents, recoveryAttempts, recoveryPlans, workflows } from "@schema";
import { detectAnomalies, errorBudget, SLO_TARGETS, type Anomaly, type HourBucket } from "@/lib/analytics/anomaly";
import { getDb } from "@/lib/db/client";
import { authorize, type ServiceContext } from "./context";

/** Org-wide execution reliability over a trailing window. */
export async function reliabilitySummary(ctx: ServiceContext, hours = 24) {
  authorize(ctx, "dashboard:read");
  const db = await getDb();
  const since = new Date(Date.now() - hours * 3_600_000);
  const [r] = await db
    .select({
      runs: sql<number>`count(*)::int`,
      failures: sql<number>`count(*) filter (where ${executions.status} in ('error','crashed'))::int`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${executions.durationMs})`,
    })
    .from(executions)
    .where(and(eq(executions.organizationId, ctx.organizationId), gte(executions.startedAt, since)));
  return {
    runs: r.runs,
    failures: r.failures,
    successRate: r.runs ? (r.runs - r.failures) / r.runs : null,
    p95Ms: r.p95 === null ? null : Math.round(Number(r.p95)),
  };
}

/** Mean time to resolve (first seen → resolved) and to acknowledge, over resolved incidents in the window. */
export async function incidentResponseTimes(ctx: ServiceContext, days = 30) {
  authorize(ctx, "dashboard:read");
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const [r] = await db
    .select({
      resolved: sql<number>`count(*) filter (where ${incidents.resolvedAt} is not null)::int`,
      mttrMs: sql<number | null>`avg(extract(epoch from (${incidents.resolvedAt} - ${incidents.firstSeenAt})) * 1000) filter (where ${incidents.resolvedAt} is not null)`,
      mttaMs: sql<number | null>`avg(extract(epoch from (${incidents.acknowledgedAt} - ${incidents.firstSeenAt})) * 1000) filter (where ${incidents.acknowledgedAt} is not null)`,
    })
    .from(incidents)
    .where(and(eq(incidents.organizationId, ctx.organizationId), gte(incidents.createdAt, since), isNotNull(incidents.firstSeenAt)));
  return { resolved: r.resolved, mttrMs: r.mttrMs === null ? null : Math.round(Number(r.mttrMs)), mttaMs: r.mttaMs === null ? null : Math.round(Number(r.mttaMs)) };
}

// ---------------------------------------------------------------------------
// Reliability analytics (GET /api/v1/analytics/reliability)
// ---------------------------------------------------------------------------

export async function detectWorkflowAnomalies(ctx: ServiceContext, opts: { recentHours?: number; baselineDays?: number; now?: Date } = {}) {
  authorize(ctx, "dashboard:read");
  const db = await getDb();
  const now = opts.now ?? new Date();
  const recentHours = opts.recentHours ?? 6;
  const baselineStart = new Date(now.getTime() - (opts.baselineDays ?? 7) * 86_400_000);
  const recentStart = new Date(now.getTime() - recentHours * 3_600_000);
  const hour = sql<string>`to_char(date_trunc('hour', ${executions.startedAt} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"')`;
  const rows = await db
    .select({
      workflowId: executions.workflowId,
      hour,
      runs: sql<number>`count(*)::int`,
      failures: sql<number>`count(*) filter (where ${executions.status} in ('error','crashed'))::int`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${executions.durationMs})`,
    })
    .from(executions)
    .where(and(eq(executions.organizationId, ctx.organizationId), gte(executions.startedAt, baselineStart), sql`${executions.mode} is distinct from 'recovery'`))
    .groupBy(executions.workflowId, hour);
  const wfs = await db.select({ id: workflows.id, name: workflows.name }).from(workflows).where(eq(workflows.organizationId, ctx.organizationId));
  const result: { workflowId: string; workflowName: string; anomalies: Anomaly[] }[] = [];
  for (const wf of wfs) {
    const buckets = rows.filter((r) => r.workflowId === wf.id).map((r) => ({ hour: r.hour, runs: r.runs, failures: r.failures, p95Ms: r.p95 === null ? null : Number(r.p95) }) satisfies HourBucket);
    const recent = buckets.filter((b) => new Date(b.hour) >= new Date(Math.floor(recentStart.getTime() / 3_600_000) * 3_600_000));
    const baseline = buckets.filter((b) => !recent.includes(b));
    const anomalies = detectAnomalies(baseline, recent, { recentHours });
    if (anomalies.length) result.push({ workflowId: wf.id, workflowName: wf.name, anomalies });
  }
  return result.sort((a, b) => Math.max(...b.anomalies.map((x) => x.score)) - Math.max(...a.anomalies.map((x) => x.score)));
}

export async function reliabilityReport(ctx: ServiceContext, days = 7) {
  authorize(ctx, "dashboard:read");
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const day = sql<string>`to_char(date_trunc('day', ${executions.startedAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
  const [summary, response, daily, perWorkflow, byCategory, recovery, anomalies] = await Promise.all([
    reliabilitySummary(ctx, days * 24),
    incidentResponseTimes(ctx, days),
    db
      .select({ day, runs: sql<number>`count(*)::int`, failures: sql<number>`count(*) filter (where ${executions.status} in ('error','crashed'))::int`, p95: sql<number | null>`percentile_cont(0.95) within group (order by ${executions.durationMs})` })
      .from(executions)
      .where(and(eq(executions.organizationId, ctx.organizationId), gte(executions.startedAt, since)))
      .groupBy(day)
      .orderBy(day),
    db
      .select({
        id: workflows.id,
        name: workflows.name,
        criticality: workflows.criticality,
        runs: sql<number>`count(${executions.id})::int`,
        failures: sql<number>`count(${executions.id}) filter (where ${executions.status} in ('error','crashed'))::int`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${executions.durationMs})`,
      })
      .from(workflows)
      .leftJoin(executions, and(eq(executions.workflowId, workflows.id), gte(executions.startedAt, since)))
      .where(eq(workflows.organizationId, ctx.organizationId))
      .groupBy(workflows.id, workflows.name, workflows.criticality)
      .orderBy(desc(sql`count(${executions.id}) filter (where ${executions.status} in ('error','crashed'))`)),
    db
      .select({ category: incidents.category, n: sql<number>`count(*)::int` })
      .from(incidents)
      .where(and(eq(incidents.organizationId, ctx.organizationId), gte(incidents.createdAt, since)))
      .groupBy(incidents.category),
    db
      .select({ status: recoveryPlans.status, n: sql<number>`count(*)::int`, attempts: sql<number>`coalesce(sum(${recoveryPlans.attemptsUsed}),0)::int` })
      .from(recoveryPlans)
      .where(and(eq(recoveryPlans.organizationId, ctx.organizationId), gte(recoveryPlans.createdAt, since)))
      .groupBy(recoveryPlans.status),
    detectWorkflowAnomalies(ctx),
  ]);
  const [attemptStats] = await db
    .select({ total: sql<number>`count(*)::int`, succeeded: sql<number>`count(*) filter (where ${recoveryAttempts.status} = 'succeeded')::int` })
    .from(recoveryAttempts)
    .where(and(eq(recoveryAttempts.organizationId, ctx.organizationId), gte(recoveryAttempts.startedAt, since), inArray(recoveryAttempts.status, ["succeeded", "failed"])));
  const planCount = (s: string) => recovery.find((r) => r.status === s)?.n ?? 0;
  const finishedPlans = planCount("succeeded") + planCount("dead_letter") + planCount("failed");

  return {
    windowDays: days,
    summary,
    response,
    daily: daily.map((d) => ({ day: d.day, runs: d.runs, failures: d.failures, successRate: d.runs ? (d.runs - d.failures) / d.runs : null, p95Ms: d.p95 === null ? null : Math.round(Number(d.p95)) })),
    workflows: perWorkflow.map((w) => {
      const target = SLO_TARGETS[w.criticality];
      return {
        id: w.id,
        name: w.name,
        criticality: w.criticality,
        runs: w.runs,
        failures: w.failures,
        successRate: w.runs ? (w.runs - w.failures) / w.runs : null,
        p95Ms: w.p95 === null ? null : Math.round(Number(w.p95)),
        slo: { target, ...errorBudget(w.runs, w.failures, target) },
      };
    }),
    incidentsByCategory: byCategory.sort((a, b) => b.n - a.n),
    recovery: {
      plans: Object.fromEntries(recovery.map((r) => [r.status, r.n])),
      planSuccessRate: finishedPlans ? planCount("succeeded") / finishedPlans : null,
      attemptSuccessRate: attemptStats.total ? attemptStats.succeeded / attemptStats.total : null,
      attempts: attemptStats.total,
    },
    anomalies,
  };
}
