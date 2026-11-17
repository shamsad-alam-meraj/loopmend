import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { aiInvestigations, executions, incidentEvents, incidents, workflows } from "@schema";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/utils/errors";
import { sanitizeText } from "@/lib/n8n/adapter";
import { runInvestigation } from "@/lib/ai/ai.service";
import type { InvestigationContext } from "@/lib/ai/types";
import type { Investigation } from "@/lib/ai/schemas/investigation.schema";
import { publishOrgEvent } from "@/lib/realtime/bus";
import { authorize, type ServiceContext } from "./context";
import { recordAudit } from "./audit.service";
import { findRelatedIncidents, transitionIncident } from "./incident.service";

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;
const ref = (n: number) => `INC-${String(n).padStart(4, "0")}`;

type AfterInvestigationHook = (ctx: ServiceContext, args: { incidentId: string; investigationId: string; result: Investigation }) => Promise<void>;
const hooks: AfterInvestigationHook[] = [];
/** The recovery module registers here to propose a plan from the recommendation. */
export function onInvestigationCompleted(hook: AfterInvestigationHook) {
  hooks.push(hook);
}

/** Builds the sanitized, bounded evidence package for an incident. */
export async function buildInvestigationContext(ctx: ServiceContext, incidentId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ incident: incidents, workflow: workflows, execution: executions })
    .from(incidents)
    .innerJoin(workflows, eq(incidents.workflowId, workflows.id))
    .leftJoin(executions, eq(incidents.executionId, executions.id))
    .where(and(eq(incidents.id, incidentId), eq(incidents.organizationId, ctx.organizationId)));
  if (!row) throw new AppError("NOT_FOUND", "Incident not found");
  const { incident: i, workflow: w, execution: e } = row;

  const recent = await db
    .select({ id: executions.id, status: executions.status, durationMs: executions.durationMs, errorCode: executions.errorCode, startedAt: executions.startedAt })
    .from(executions)
    .where(eq(executions.workflowId, w.id))
    .orderBy(desc(executions.startedAt))
    .limit(20);
  const stat = async (from: Date, to?: Date) => {
    const [r] = await db
      .select({
        runs: sql<number>`count(*)::int`,
        failures: sql<number>`count(*) filter (where ${executions.status} in ('error','crashed'))::int`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${executions.durationMs})`,
      })
      .from(executions)
      .where(and(eq(executions.workflowId, w.id), gte(executions.startedAt, from), ...(to ? [sql`${executions.startedAt} < ${to}`] : [])));
    return r;
  };
  const now = Date.now();
  const [last24, baseline] = await Promise.all([stat(new Date(now - 86_400_000)), stat(new Date(now - 8 * 86_400_000), new Date(now - 86_400_000))]);
  const related = await findRelatedIncidents(ctx, i, 5);

  const context: InvestigationContext = {
    incident: {
      ref: ref(i.number),
      title: sanitizeText(i.title, 200),
      errorCode: i.errorCode,
      errorMessage: i.errorMessage ? sanitizeText(i.errorMessage, 600) : null,
      failedNode: e?.errorNode ?? null,
      httpStatus: e?.httpStatus ?? null,
      preliminaryCategory: i.category,
      preliminarySeverity: i.severity,
      occurrences: i.occurrenceCount,
      firstSeenAt: i.firstSeenAt.toISOString(),
      lastSeenAt: i.lastSeenAt.toISOString(),
    },
    workflow: { name: w.name, criticality: w.criticality, sideEffectProfile: w.sideEffectProfile, autoRecoveryEnabled: w.autoRecoveryEnabled },
    recentExecutions: recent.map((r) => ({ status: r.status, durationMs: r.durationMs, errorCode: r.errorCode, startedAt: r.startedAt.toISOString() })),
    executionStats: {
      window: "last 24h",
      runs: last24.runs,
      failures: last24.failures,
      p95Ms: last24.p95 === null ? null : Math.round(Number(last24.p95)),
      baselineP95Ms: baseline.p95 === null ? null : Math.round(Number(baseline.p95)),
    },
    relatedIncidents: related.map((r) => ({ ref: ref(r.number), category: r.category, status: r.status, sameSignature: r.sameSignature })),
  };
  const evidenceRefs = {
    incidentId: i.id,
    executionId: e?.id ?? null,
    recentExecutionIds: recent.map((r) => r.id),
    relatedIncidentIds: related.map((r) => r.id),
  };
  return { context, evidenceRefs, incident: i, workflow: w };
}

/** POST /incidents/:id/investigate — runs the pipeline and persists a validated result. */
export async function investigateIncident(ctx: ServiceContext, incidentId: string) {
  authorize(ctx, "incident:investigate");
  const db = await getDb();
  const { context, evidenceRefs, incident } = await buildInvestigationContext(ctx, incidentId);
  if (["resolved", "dismissed"].includes(incident.status)) throw new AppError("CONFLICT", `Incident is ${incident.status}; reopen it to investigate`);

  // Single-flight: one pending investigation per incident.
  const pending = await db
    .select({ id: aiInvestigations.id })
    .from(aiInvestigations)
    .where(and(eq(aiInvestigations.incidentId, incidentId), eq(aiInvestigations.status, "pending"), gte(aiInvestigations.createdAt, new Date(Date.now() - 2 * 60_000))));
  if (pending.length) throw new AppError("CONFLICT", "An investigation is already running for this incident");

  const [row] = await db.transaction(async (tx) => {
    const created = await tx
      .insert(aiInvestigations)
      .values({ organizationId: ctx.organizationId, incidentId, status: "pending", provider: "pending", model: "pending", promptVersion: "pending", evidenceRefs, requestedBy: ctx.actor.id })
      .returning();
    if (["open", "awaiting_approval", "dead_letter"].includes(incident.status)) {
      await transitionIncident(tx, ctx, incidentId, "investigating", { reason: "AI investigation started" });
    }
    return created;
  });

  let run;
  try {
    run = await runInvestigation(context);
  } catch (e) {
    await db.update(aiInvestigations).set({ status: "failed", error: (e as Error).message, completedAt: new Date() }).where(eq(aiInvestigations.id, row.id));
    await db.transaction((tx) => transitionIncident(tx, ctx, incidentId, "open", { reason: "Investigation failed" }));
    throw new AppError("UPSTREAM_FAILURE", "Investigation failed; the incident was returned to open");
  }
  const r = run.result;

  const saved = await db.transaction(async (tx) => {
    const [inv] = await tx
      .update(aiInvestigations)
      .set({
        status: "completed",
        provider: run.provider,
        model: run.model,
        promptVersion: run.promptVersion,
        diagnosis: r as unknown as Record<string, unknown>,
        category: r.category,
        severity: r.severity,
        rootCauseSummary: r.rootCause.summary,
        confidence: r.confidence,
        usedFallback: run.usedFallback,
        error: run.error,
        latencyMs: run.latencyMs,
        completedAt: new Date(),
      })
      .where(eq(aiInvestigations.id, row.id))
      .returning();
    // Category may be refined; severity may only escalate automatically.
    const [current] = await tx.select().from(incidents).where(eq(incidents.id, incidentId));
    const patch: Partial<typeof incidents.$inferInsert> = { updatedAt: new Date() };
    if (current.category === "unknown" || run.provider !== "rules") patch.category = r.category;
    if (SEVERITY_RANK[r.severity] > SEVERITY_RANK[current.severity]) patch.severity = r.severity;
    await tx.update(incidents).set(patch).where(eq(incidents.id, incidentId));
    await tx.insert(incidentEvents).values({
      organizationId: ctx.organizationId,
      incidentId,
      eventType: "investigation_completed",
      actorType: run.provider === "rules" ? "system" : "ai",
      actorId: null,
      metadata: { investigationId: inv.id, provider: run.provider, model: run.model, strategy: r.recommendation.strategy, confidence: r.confidence, usedFallback: run.usedFallback },
    });
    if (current.status === "investigating") await transitionIncident(tx, ctx, incidentId, "open", { reason: "Investigation completed" });
    await recordAudit(tx, ctx, {
      action: "investigation.completed",
      targetType: "incident",
      targetId: incidentId,
      metadata: { investigationId: inv.id, provider: run.provider, model: run.model, promptVersion: run.promptVersion, usedFallback: run.usedFallback, strategy: r.recommendation.strategy },
    });
    return inv;
  });

  publishOrgEvent(ctx.organizationId, { type: "investigation.completed", id: incidentId, summary: r.rootCause.summary });
  for (const hook of hooks) await hook(ctx, { incidentId, investigationId: saved.id, result: r });
  return saved;
}

export async function listInvestigations(ctx: ServiceContext, opts: { incidentId?: string; limit?: number } = {}) {
  authorize(ctx, "incident:read");
  const db = await getDb();
  return db
    .select({ investigation: aiInvestigations, incidentNumber: incidents.number, incidentTitle: incidents.title, workflowName: workflows.name })
    .from(aiInvestigations)
    .innerJoin(incidents, eq(aiInvestigations.incidentId, incidents.id))
    .innerJoin(workflows, eq(incidents.workflowId, workflows.id))
    .where(and(eq(aiInvestigations.organizationId, ctx.organizationId), ...(opts.incidentId ? [eq(aiInvestigations.incidentId, opts.incidentId)] : [])))
    .orderBy(desc(aiInvestigations.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}
