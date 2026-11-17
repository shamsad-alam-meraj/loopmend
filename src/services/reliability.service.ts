import "server-only";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { executions, incidents } from "@schema";
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
