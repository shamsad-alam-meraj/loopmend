import "server-only";
import { and, count, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { executions, incidents, workflows, type ExecutionStatus } from "@schema";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/utils/errors";
import { ACTIVE_STATUSES } from "@/lib/incidents/state";
import { decodeCursor, encodeCursor } from "@/lib/validation/query.schema";
import { authorize, type ServiceContext } from "./context";
import { recordAudit } from "./audit.service";

export type WorkflowStats = {
  runs: number;
  failures: number;
  successRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  avgMs: number | null;
};

const statsColumns = {
  runs: sql<number>`count(*)::int`,
  failures: sql<number>`count(*) filter (where ${executions.status} in ('error','crashed'))::int`,
  p50: sql<number | null>`percentile_cont(0.5) within group (order by ${executions.durationMs})`,
  p95: sql<number | null>`percentile_cont(0.95) within group (order by ${executions.durationMs})`,
  avg: sql<number | null>`avg(${executions.durationMs})`,
};

function toStats(r: { runs: number; failures: number; p50: number | null; p95: number | null; avg: number | null } | undefined): WorkflowStats {
  if (!r || r.runs === 0) return { runs: 0, failures: 0, successRate: null, p50Ms: null, p95Ms: null, avgMs: null };
  return {
    runs: r.runs,
    failures: r.failures,
    successRate: (r.runs - r.failures) / r.runs,
    p50Ms: r.p50 === null ? null : Math.round(Number(r.p50)),
    p95Ms: r.p95 === null ? null : Math.round(Number(r.p95)),
    avgMs: r.avg === null ? null : Math.round(Number(r.avg)),
  };
}

export async function listWorkflows(ctx: ServiceContext, opts: { windowHours?: number } = {}) {
  authorize(ctx, "dashboard:read");
  const db = await getDb();
  const since = new Date(Date.now() - (opts.windowHours ?? 24) * 3_600_000);
  const [wfs, stats, open] = await Promise.all([
    db.select().from(workflows).where(eq(workflows.organizationId, ctx.organizationId)).orderBy(workflows.name),
    db
      .select({ workflowId: executions.workflowId, ...statsColumns })
      .from(executions)
      .where(and(eq(executions.organizationId, ctx.organizationId), gte(executions.startedAt, since)))
      .groupBy(executions.workflowId),
    db
      .select({ workflowId: incidents.workflowId, n: count() })
      .from(incidents)
      .where(and(eq(incidents.organizationId, ctx.organizationId), inArray(incidents.status, ACTIVE_STATUSES)))
      .groupBy(incidents.workflowId),
  ]);
  const statMap = new Map(stats.map((s) => [s.workflowId, s]));
  const openMap = new Map(open.map((o) => [o.workflowId, o.n]));
  return wfs.map((w) => {
    const s = toStats(statMap.get(w.id));
    const openIncidents = openMap.get(w.id) ?? 0;
    const health: "healthy" | "degraded" | "failing" | "idle" =
      s.runs === 0 ? "idle" : (s.successRate ?? 1) < 0.8 ? "failing" : (s.successRate ?? 1) < 0.97 || openIncidents > 0 ? "degraded" : "healthy";
    return { ...w, stats: s, openIncidents, health };
  });
}

export async function getWorkflow(ctx: ServiceContext, id: string) {
  authorize(ctx, "dashboard:read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND", "Workflow not found");
  const db = await getDb();
  const [wf] = await db.select().from(workflows).where(and(eq(workflows.id, id), eq(workflows.organizationId, ctx.organizationId)));
  if (!wf) throw new AppError("NOT_FOUND", "Workflow not found");
  const window = async (hours: number) => {
    const [r] = await db
      .select(statsColumns)
      .from(executions)
      .where(and(eq(executions.workflowId, id), gte(executions.startedAt, new Date(Date.now() - hours * 3_600_000))));
    return toStats(r);
  };
  const [day, week] = await Promise.all([window(24), window(24 * 7)]);
  return { workflow: wf, stats: { day, week } };
}

export async function listExecutions(ctx: ServiceContext, workflowId: string, opts: { status?: ExecutionStatus[]; cursor?: string; limit?: number } = {}) {
  authorize(ctx, "dashboard:read");
  const db = await getDb();
  const [wf] = await db.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.id, workflowId), eq(workflows.organizationId, ctx.organizationId)));
  if (!wf) throw new AppError("NOT_FOUND", "Workflow not found");
  const limit = opts.limit ?? 50;
  const where: SQL[] = [eq(executions.workflowId, workflowId), eq(executions.organizationId, ctx.organizationId)];
  if (opts.status?.length) where.push(inArray(executions.status, opts.status));
  const cursor = decodeCursor(opts.cursor);
  if (cursor) where.push(or(lt(executions.startedAt, cursor.date), and(eq(executions.startedAt, cursor.date), lt(executions.id, cursor.id)))!);
  const rows = await db.select().from(executions).where(and(...where)).orderBy(desc(executions.startedAt), desc(executions.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { items: page, nextCursor: rows.length > limit && last ? encodeCursor(last.startedAt, last.id) : null };
}

/** Hourly execution buckets for sparklines/charts. */
export async function executionTimeline(ctx: ServiceContext, opts: { workflowId?: string; hours?: number; bucket?: "hour" | "day" } = {}) {
  authorize(ctx, "dashboard:read");
  const db = await getDb();
  const bucket = opts.bucket ?? "hour";
  const since = new Date(Date.now() - (opts.hours ?? 24) * 3_600_000);
  const where: SQL[] = [eq(executions.organizationId, ctx.organizationId), gte(executions.startedAt, since)];
  if (opts.workflowId) where.push(eq(executions.workflowId, opts.workflowId));
  const trunc = sql<string>`to_char(date_trunc(${sql.raw(`'${bucket}'`)}, ${executions.startedAt} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"')`;
  const rows = await db
    .select({ bucket: trunc, runs: statsColumns.runs, failures: statsColumns.failures, p95: statsColumns.p95 })
    .from(executions)
    .where(and(...where))
    .groupBy(trunc)
    .orderBy(trunc);
  return rows.map((r) => ({ bucket: r.bucket, runs: r.runs, failures: r.failures, success: r.runs - r.failures, p95Ms: r.p95 === null ? null : Math.round(Number(r.p95)) }));
}

export async function updateWorkflowSettings(
  ctx: ServiceContext,
  id: string,
  input: { criticality?: (typeof workflows.$inferSelect)["criticality"]; sideEffectProfile?: (typeof workflows.$inferSelect)["sideEffectProfile"]; autoRecoveryEnabled?: boolean; status?: "active" | "inactive" | "archived" },
) {
  authorize(ctx, "workflow:manage");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [wf] = await tx.select().from(workflows).where(and(eq(workflows.id, id), eq(workflows.organizationId, ctx.organizationId)));
    if (!wf) throw new AppError("NOT_FOUND", "Workflow not found");
    // Safety: workflows with financial/destructive side effects can never auto-recover.
    if (input.autoRecoveryEnabled && ["financial", "destructive"].includes(input.sideEffectProfile ?? wf.sideEffectProfile)) {
      throw new AppError("POLICY_VIOLATION", "Auto-recovery cannot be enabled for financial or destructive workflows");
    }
    const patch = { ...input, updatedAt: new Date() };
    if (input.sideEffectProfile && ["financial", "destructive"].includes(input.sideEffectProfile)) patch.autoRecoveryEnabled = false;
    const [updated] = await tx.update(workflows).set(patch).where(eq(workflows.id, id)).returning();
    const changes = Object.fromEntries(
      Object.entries(input).filter(([k, v]) => v !== undefined && (wf as Record<string, unknown>)[k] !== v).map(([k, v]) => [k, { from: (wf as Record<string, unknown>)[k], to: v }]),
    );
    await recordAudit(tx, ctx, { action: "workflow.settings_changed", targetType: "workflow", targetId: id, metadata: { name: wf.name, changes } });
    return updated;
  });
}
