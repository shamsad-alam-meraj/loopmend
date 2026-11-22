import "server-only";
import { and, count, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import {
  aiInvestigations,
  approvals,
  executions,
  incidentEvents,
  incidents,
  integrations,
  profiles,
  recoveryAttempts,
  recoveryPlans,
  workflows,
  type RecoveryStatus,
  type RecoveryStrategy,
} from "@schema";
import { getDb, type Executor, type Tx } from "@/lib/db/client";
import { AppError } from "@/lib/utils/errors";
import { sha256Hex } from "@/lib/security/crypto";
import { can } from "@/lib/security/rbac";
import { logger } from "@/lib/utils/logger";
import { publishOrgEvent } from "@/lib/realtime/bus";
import { evaluatePolicy, RETRY_STRATEGIES, type PolicyDecision } from "@/lib/recovery/policy";
import { nextAttemptAt } from "@/lib/recovery/backoff";
import { N8nRecoveryExecutor, SimulatedRecoveryExecutor, type RecoveryExecutor, type RecoveryRequest, type RecoveryResult } from "@/lib/recovery/executor";
import type { Investigation } from "@/lib/ai/schemas/investigation.schema";
import { authorize, systemContext, type ServiceContext } from "./context";
import { recordAudit } from "./audit.service";
import { transitionIncident } from "./incident.service";
import { openSecrets } from "./integration.service";

const ACTIVE_PLAN: RecoveryStatus[] = ["pending_approval", "approved", "executing"];
const STUCK_EXECUTION_MS = 10 * 60_000;

// ------------------------------------------------------------------ executor resolution
let executorOverride: RecoveryExecutor | undefined;
/** Test hook. */
export function __setRecoveryExecutor(e: RecoveryExecutor | undefined) {
  executorOverride = e;
}

async function resolveExecutor(orgId: string): Promise<RecoveryExecutor> {
  if (executorOverride) return executorOverride;
  const url = process.env.N8N_WEBHOOK_URL?.trim();
  if (url) {
    const db = await getDb();
    const [integration] = await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.organizationId, orgId), eq(integrations.type, "n8n"), ne(integrations.status, "disabled")))
      .limit(1);
    if (!integration) throw new AppError("SERVICE_UNAVAILABLE", "No n8n integration to sign recovery requests");
    return new N8nRecoveryExecutor(url, openSecrets(orgId, integration.encryptedConfig).webhookSecret, integration.id);
  }
  const demo = process.env.ENABLE_DEMO_MODE ? process.env.ENABLE_DEMO_MODE === "true" : process.env.NODE_ENV !== "production";
  if (demo) return new SimulatedRecoveryExecutor();
  throw new AppError("SERVICE_UNAVAILABLE", "No recovery executor configured (set N8N_WEBHOOK_URL)");
}

// ------------------------------------------------------------------ helpers
async function loadPlanForUpdate(tx: Tx, ctx: ServiceContext, planId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(planId)) throw new AppError("NOT_FOUND", "Recovery plan not found");
  const [plan] = await tx
    .select()
    .from(recoveryPlans)
    .where(and(eq(recoveryPlans.id, planId), eq(recoveryPlans.organizationId, ctx.organizationId)))
    .for("update");
  if (!plan) throw new AppError("NOT_FOUND", "Recovery plan not found");
  return plan;
}

async function incidentEvent(ex: Executor, ctx: ServiceContext, incidentId: string, eventType: string, metadata: Record<string, unknown>) {
  await ex.insert(incidentEvents).values({ organizationId: ctx.organizationId, incidentId, eventType, actorType: ctx.actor.type, actorId: ctx.actor.id, metadata });
}

async function moveToDeadLetter(tx: Tx, ctx: ServiceContext, plan: typeof recoveryPlans.$inferSelect, reason: string) {
  await tx.update(recoveryPlans).set({ status: "dead_letter", deadLetterReason: reason, nextAttemptAt: null, updatedAt: new Date() }).where(eq(recoveryPlans.id, plan.id));
  const [inc] = await tx.select({ status: incidents.status }).from(incidents).where(eq(incidents.id, plan.incidentId));
  if (inc && !["resolved", "dismissed", "dead_letter"].includes(inc.status)) {
    await transitionIncident(tx, ctx, plan.incidentId, "dead_letter", { reason, planId: plan.id });
  }
  await recordAudit(tx, ctx, { action: "recovery.dead_lettered", targetType: "recovery_plan", targetId: plan.id, metadata: { reason, attemptsUsed: plan.attemptsUsed } });
}

async function workflowAttemptsLast24h(ex: Executor, workflowId: string) {
  const [r] = await ex
    .select({ n: count() })
    .from(recoveryAttempts)
    .innerJoin(recoveryPlans, eq(recoveryAttempts.recoveryPlanId, recoveryPlans.id))
    .innerJoin(incidents, eq(recoveryPlans.incidentId, incidents.id))
    .where(and(eq(incidents.workflowId, workflowId), gte(recoveryAttempts.startedAt, new Date(Date.now() - 86_400_000))));
  return r.n;
}

// ------------------------------------------------------------------ create
export type CreatePlanInput = {
  incidentId: string;
  strategy?: RecoveryStrategy;
  maxAttempts?: number;
  investigationId?: string | null;
  rationale?: string;
  idempotencyKey?: string;
};

/** POST /recovery-plans — evaluates deterministic policy and creates an idempotent plan. */
export async function createRecoveryPlan(ctx: ServiceContext, input: CreatePlanInput) {
  authorize(ctx, "recovery:create");
  const db = await getDb();

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ incident: incidents, workflow: workflows })
      .from(incidents)
      .innerJoin(workflows, eq(incidents.workflowId, workflows.id))
      .where(and(eq(incidents.id, input.incidentId), eq(incidents.organizationId, ctx.organizationId)))
      .for("update", { of: incidents });
    if (!row) throw new AppError("NOT_FOUND", "Incident not found");
    const { incident, workflow } = row;

    // Default strategy & attempts from the latest completed investigation.
    let investigationId = input.investigationId ?? null;
    let strategy = input.strategy;
    let aiConfidence: number | null = null;
    let requestedMax = input.maxAttempts;
    const [latest] = await tx
      .select()
      .from(aiInvestigations)
      .where(and(eq(aiInvestigations.incidentId, incident.id), eq(aiInvestigations.status, "completed"), ...(investigationId ? [eq(aiInvestigations.id, investigationId)] : [])))
      .orderBy(desc(aiInvestigations.createdAt))
      .limit(1);
    if (latest) {
      const d = latest.diagnosis as unknown as Investigation;
      investigationId = latest.id;
      aiConfidence = latest.confidence;
      strategy ??= d.recommendation.strategy;
      if (strategy === d.recommendation.strategy) requestedMax ??= d.recommendation.maxAttempts;
    } else if (input.investigationId) {
      throw new AppError("NOT_FOUND", "Investigation not found");
    }
    if (!strategy) throw new AppError("VALIDATION_FAILED", "Choose a strategy or run an investigation first");

    const [existingCount] = await tx.select({ n: count() }).from(recoveryPlans).where(eq(recoveryPlans.incidentId, incident.id));
    const idempotencyKey = input.idempotencyKey
      ? `client:${ctx.organizationId}:${sha256Hex(input.idempotencyKey).slice(0, 32)}`
      : `plan:${incident.id}:${existingCount.n + 1}`;

    const [replay] = await tx.select().from(recoveryPlans).where(eq(recoveryPlans.idempotencyKey, idempotencyKey));
    if (replay) {
      if (replay.organizationId !== ctx.organizationId) throw new AppError("CONFLICT", "Idempotency key already used");
      return { plan: replay, duplicate: true, decision: null as PolicyDecision | null };
    }

    const [active] = await tx.select({ id: recoveryPlans.id }).from(recoveryPlans).where(and(eq(recoveryPlans.incidentId, incident.id), inArray(recoveryPlans.status, ACTIVE_PLAN)));
    if (active) throw new AppError("CONFLICT", "This incident already has an active recovery plan");

    const decision = evaluatePolicy({
      strategy,
      requestedMaxAttempts: requestedMax,
      workflow,
      incident: { category: incident.category, severity: incident.severity, occurrences: incident.occurrenceCount, status: incident.status },
      aiConfidence,
      recentAttemptsForWorkflow: await workflowAttemptsLast24h(tx, workflow.id),
    });
    if (!decision.allowed) {
      throw new AppError("POLICY_VIOLATION", decision.reasons[0] ?? "Recovery blocked by policy", { checks: decision.checks.filter((c) => !c.passed) });
    }

    const now = new Date();
    const manual = strategy === "manual_review";
    const status: RecoveryStatus = manual ? "dead_letter" : decision.requiresApproval ? "pending_approval" : "approved";
    const [plan] = await tx
      .insert(recoveryPlans)
      .values({
        organizationId: ctx.organizationId,
        incidentId: incident.id,
        investigationId,
        strategy,
        status,
        riskLevel: decision.riskLevel,
        requiresApproval: decision.requiresApproval,
        maxAttempts: decision.maxAttempts,
        baseDelayMs: decision.baseDelayMs,
        deadlineAt: new Date(now.getTime() + decision.deadlineMs),
        idempotencyKey,
        policy: decision as unknown as Record<string, unknown>,
        rationale: input.rationale ?? null,
        deadLetterReason: manual ? "Manual review requested" : null,
        createdBy: ctx.actor.id,
      })
      .onConflictDoNothing({ target: recoveryPlans.idempotencyKey })
      .returning();
    if (!plan) {
      const [winner] = await tx.select().from(recoveryPlans).where(eq(recoveryPlans.idempotencyKey, idempotencyKey));
      return { plan: winner, duplicate: true, decision };
    }

    await incidentEvent(tx, ctx, incident.id, "recovery_planned", { planId: plan.id, strategy, riskLevel: decision.riskLevel, requiresApproval: decision.requiresApproval });
    if (manual) await transitionIncident(tx, ctx, incident.id, "dead_letter", { reason: "Manual review requested", planId: plan.id });
    else if (decision.requiresApproval) await transitionIncident(tx, ctx, incident.id, "awaiting_approval", { planId: plan.id });
    await recordAudit(tx, ctx, {
      action: decision.requiresApproval || manual ? "recovery.plan_created" : "recovery.plan_auto_approved",
      targetType: "recovery_plan",
      targetId: plan.id,
      metadata: { incidentId: incident.id, strategy, riskLevel: decision.riskLevel, maxAttempts: decision.maxAttempts, requiresApproval: decision.requiresApproval, reasons: decision.reasons, aiConfidence },
    });
    return { plan, duplicate: false, decision };
  });

  if (!created.duplicate) publishOrgEvent(ctx.organizationId, { type: "recovery.updated", id: created.plan.id, summary: `Plan ${created.plan.strategy}` });
  // Low-risk, policy-approved plans execute immediately (self-healing path).
  if (!created.duplicate && created.plan.status === "approved" && !created.plan.requiresApproval) {
    const outcome = await executeRecoveryPlan(systemContext(ctx.organizationId, ctx.requestId), created.plan.id).catch((e) => {
      logger.warn("auto-execution failed", { planId: created.plan.id, reason: (e as Error).message });
      return null;
    });
    if (outcome) return { ...created, plan: outcome.plan };
  }
  return created;
}

// ------------------------------------------------------------------ approve / reject
export async function decideRecoveryPlan(ctx: ServiceContext, planId: string, decision: "approved" | "rejected", comment?: string) {
  authorize(ctx, "recovery:approve");
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw new AppError("FORBIDDEN", "Approvals must be made by a person");
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const plan = await loadPlanForUpdate(tx, ctx, planId);
    if (plan.status !== "pending_approval") throw new AppError("CONFLICT", `Plan is ${plan.status}; only pending plans can be decided`);
    const policy = plan.policy as unknown as PolicyDecision;
    if (decision === "approved") {
      if (policy.approverMinRole === "admin" && !can(ctx.role, "recovery:approve_high_risk")) {
        throw new AppError("FORBIDDEN", "High-risk recovery plans require an admin or owner to approve");
      }
      if (policy.requiresSeparateApprover && plan.createdBy === ctx.actor.id) {
        throw new AppError("FORBIDDEN", "High-risk plans need a second person: you cannot approve a plan you requested");
      }
      if (plan.deadlineAt < new Date()) {
        await moveToDeadLetter(tx, ctx, plan, "Approval deadline passed");
        return { ...plan, status: "dead_letter" as const };
      }
    }
    // The unique index on approvals.recovery_plan_id makes double decisions impossible.
    await tx.insert(approvals).values({ organizationId: ctx.organizationId, recoveryPlanId: plan.id, decidedBy: ctx.actor.id!, decision, comment: comment ?? null });
    const [updated] = await tx.update(recoveryPlans).set({ status: decision, updatedAt: new Date() }).where(eq(recoveryPlans.id, plan.id)).returning();
    await incidentEvent(tx, ctx, plan.incidentId, decision === "approved" ? "recovery_approved" : "recovery_rejected", { planId: plan.id, comment });
    if (decision === "rejected") await transitionIncident(tx, ctx, plan.incidentId, "open", { reason: "Recovery plan rejected", planId: plan.id });
    await recordAudit(tx, ctx, { action: `recovery.${decision === "approved" ? "approved" : "rejected"}`, targetType: "recovery_plan", targetId: plan.id, metadata: { strategy: plan.strategy, riskLevel: plan.riskLevel, comment } });
    return updated;
  });
  publishOrgEvent(ctx.organizationId, { type: "approval.recorded", id: planId, summary: decision });
  return result;
}

// ------------------------------------------------------------------ execute
export type ExecuteOutcome = { plan: typeof recoveryPlans.$inferSelect; attempt: typeof recoveryAttempts.$inferSelect | null; duplicate: boolean; result: RecoveryResult | null };

/**
 * POST /recovery-plans/:id/execute — runs ONE attempt of an approved plan.
 * Atomic claim (status approved → executing under row lock) + a unique
 * per-attempt idempotency key guarantee no duplicate side effects from
 * concurrent or repeated requests.
 */
export async function executeRecoveryPlan(ctx: ServiceContext, planId: string, opts: { now?: Date } = {}): Promise<ExecuteOutcome> {
  authorize(ctx, "recovery:execute");
  const db = await getDb();
  const now = opts.now ?? new Date();

  const claim = await db.transaction(async (tx) => {
    const plan = await loadPlanForUpdate(tx, ctx, planId);
    if (plan.status === "succeeded") return { kind: "done" as const, plan };
    if (plan.status === "executing") throw new AppError("CONFLICT", "An attempt for this plan is already in progress");
    if (plan.status === "pending_approval") throw new AppError("FORBIDDEN", "This plan requires approval before execution");
    if (plan.status !== "approved") throw new AppError("CONFLICT", `Plan is ${plan.status}`);
    if (plan.deadlineAt < now) {
      await moveToDeadLetter(tx, ctx, plan, "Recovery deadline exceeded");
      return { kind: "dead" as const, plan: { ...plan, status: "dead_letter" as const } };
    }
    if (plan.attemptsUsed >= plan.maxAttempts) {
      await moveToDeadLetter(tx, ctx, plan, "Retry budget exhausted");
      return { kind: "dead" as const, plan: { ...plan, status: "dead_letter" as const } };
    }
    if (plan.nextAttemptAt && plan.nextAttemptAt > now) {
      throw new AppError("CONFLICT", `Backoff in effect until ${plan.nextAttemptAt.toISOString()}`);
    }
    const attemptNumber = plan.attemptsUsed + 1;
    const [claimed] = await tx
      .update(recoveryPlans)
      .set({ status: "executing", attemptsUsed: attemptNumber, nextAttemptAt: null, updatedAt: now })
      .where(and(eq(recoveryPlans.id, plan.id), eq(recoveryPlans.status, "approved")))
      .returning();
    const [attempt] = await tx
      .insert(recoveryAttempts)
      .values({ organizationId: ctx.organizationId, recoveryPlanId: plan.id, attemptNumber, idempotencyKey: `${plan.idempotencyKey}:attempt:${attemptNumber}`, status: "started" })
      .returning();
    await transitionIncident(tx, ctx, plan.incidentId, "recovering", { planId: plan.id, attempt: attemptNumber });
    await recordAudit(tx, ctx, { action: "recovery.execution_requested", targetType: "recovery_plan", targetId: plan.id, metadata: { attempt: attemptNumber, idempotencyKey: attempt.idempotencyKey, strategy: plan.strategy } });
    const [ctxRow] = await tx
      .select({ incident: incidents, workflow: workflows, execution: executions })
      .from(incidents)
      .innerJoin(workflows, eq(incidents.workflowId, workflows.id))
      .leftJoin(executions, eq(incidents.executionId, executions.id))
      .where(eq(incidents.id, plan.incidentId));
    return { kind: "claimed" as const, plan: claimed, attempt, ...ctxRow };
  });

  if (claim.kind === "done") return { plan: claim.plan, attempt: null, duplicate: true, result: null };
  if (claim.kind === "dead") return { plan: claim.plan as typeof recoveryPlans.$inferSelect, attempt: null, duplicate: false, result: null };

  const { plan, attempt, incident, workflow, execution } = claim;
  const policy = plan.policy as unknown as PolicyDecision;
  let result: RecoveryResult;
  const started = Date.now();
  try {
    // Non-negotiable: check whether the original side effect already happened before retrying.
    const alreadyRecovered = policy.requiresSideEffectCheck ? await sideEffectAlreadyOccurred(workflow.id, execution?.externalId ?? null, incident.firstSeenAt) : null;
    if (alreadyRecovered) {
      result = { status: "succeeded", executionId: alreadyRecovered, message: `Side-effect check: execution ${alreadyRecovered} already completed this work; no retry performed` };
    } else {
      const executor = await resolveExecutor(ctx.organizationId);
      const req: RecoveryRequest = {
        planId: plan.id,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        idempotencyKey: attempt.idempotencyKey,
        strategy: plan.strategy,
        organizationId: ctx.organizationId,
        workflow: { externalId: workflow.externalId, name: workflow.name },
        originalExecutionId: execution?.externalId ?? null,
        incident: { id: incident.id, number: incident.number, category: incident.category },
        deadline: plan.deadlineAt.toISOString(),
      };
      result = await executor.execute(req);
    }
  } catch (e) {
    result = { status: "failed", retryable: false, message: e instanceof AppError ? e.message : `Executor error: ${(e as Error).message}` };
  }
  if (result.status === "accepted") {
    await db.update(recoveryAttempts).set({ result: { accepted: true, message: result.message } }).where(eq(recoveryAttempts.id, attempt.id));
    return { plan, attempt, duplicate: false, result };
  }
  const finalized = await finalizeAttempt(ctx, attempt.id, { ...result, durationMs: result.durationMs ?? Date.now() - started }, now);
  return { ...finalized, duplicate: false, result };
}

/** Did a successful run of this work already happen after the failure (e.g. n8n's own retry)? */
async function sideEffectAlreadyOccurred(workflowId: string, originalExternalId: string | null, since: Date): Promise<string | null> {
  if (!originalExternalId) return null;
  const db = await getDb();
  const [hit] = await db
    .select({ externalId: executions.externalId })
    .from(executions)
    .where(and(eq(executions.workflowId, workflowId), eq(executions.status, "success"), gte(executions.startedAt, since), sql`${executions.metadata}->>'retryOf' = ${originalExternalId}`))
    .limit(1);
  return hit?.externalId ?? null;
}

/** Records an attempt outcome (sync executor result or async n8n callback). Idempotent per attempt. */
export async function finalizeAttempt(ctx: ServiceContext, attemptId: string, result: Exclude<RecoveryResult, { status: "accepted" }>, at?: Date) {
  const db = await getDb();
  const out = await db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(recoveryAttempts)
      .where(and(eq(recoveryAttempts.id, attemptId), eq(recoveryAttempts.organizationId, ctx.organizationId)))
      .for("update");
    if (!attempt) throw new AppError("NOT_FOUND", "Recovery attempt not found");
    const plan = await loadPlanForUpdate(tx, ctx, attempt.recoveryPlanId);
    if (attempt.status !== "started") return { plan, attempt };

    const now = at ?? new Date();
    const [finished] = await tx
      .update(recoveryAttempts)
      .set({ status: result.status, result: { message: result.message, executionId: result.executionId ?? null, ...(result.status === "failed" ? { retryable: result.retryable } : {}) }, error: result.status === "failed" ? result.message : null, durationMs: result.durationMs ?? null, finishedAt: now })
      .where(eq(recoveryAttempts.id, attempt.id))
      .returning();

    const [inc] = await tx.select().from(incidents).where(eq(incidents.id, plan.incidentId));
    if (result.executionId && RETRY_STRATEGIES.includes(plan.strategy)) {
      await tx
        .insert(executions)
        .values({
          organizationId: ctx.organizationId,
          workflowId: inc.workflowId,
          externalId: result.executionId,
          status: result.status === "succeeded" ? "success" : "error",
          mode: "recovery",
          startedAt: new Date(now.getTime() - (result.durationMs ?? 0)),
          finishedAt: now,
          durationMs: result.durationMs ?? null,
          errorMessage: result.status === "failed" ? result.message : null,
          recoveryAttemptId: attempt.id,
          metadata: { recoveryPlanId: plan.id },
        })
        .onConflictDoNothing();
    }

    let updatedPlan = plan;
    if (result.status === "succeeded") {
      [updatedPlan] = await tx.update(recoveryPlans).set({ status: "succeeded", updatedAt: now }).where(eq(recoveryPlans.id, plan.id)).returning();
      await incidentEvent(tx, ctx, plan.incidentId, "recovery_succeeded", { planId: plan.id, attempt: attempt.attemptNumber, message: result.message });
      if (plan.strategy === "pause_workflow") {
        await tx.update(workflows).set({ status: "inactive", updatedAt: now }).where(eq(workflows.id, inc.workflowId));
        await transitionIncident(tx, ctx, plan.incidentId, "open", { reason: "Workflow paused; root cause still needs a fix", planId: plan.id });
      } else if (plan.strategy === "notify_owner") {
        await transitionIncident(tx, ctx, plan.incidentId, "open", { reason: "Owner notified; awaiting a fix", planId: plan.id });
      } else {
        await transitionIncident(tx, ctx, plan.incidentId, "resolved", { reason: `Recovered on attempt ${attempt.attemptNumber}`, planId: plan.id });
      }
      await recordAudit(tx, ctx, { action: "recovery.succeeded", targetType: "recovery_plan", targetId: plan.id, metadata: { attempt: attempt.attemptNumber, message: result.message, executionId: result.executionId ?? null } });
    } else {
      await incidentEvent(tx, ctx, plan.incidentId, "recovery_attempt_failed", { planId: plan.id, attempt: attempt.attemptNumber, message: result.message });
      await recordAudit(tx, ctx, { action: "recovery.attempt_failed", targetType: "recovery_plan", targetId: plan.id, metadata: { attempt: attempt.attemptNumber, message: result.message, retryable: result.retryable } });
      const canRetry = result.retryable && plan.attemptsUsed < plan.maxAttempts;
      const next = canRetry ? nextAttemptAt(now, plan.attemptsUsed, { baseMs: plan.baseDelayMs, deadline: plan.deadlineAt }) : null;
      if (canRetry && next) {
        [updatedPlan] = await tx.update(recoveryPlans).set({ status: "approved", nextAttemptAt: next, updatedAt: now }).where(eq(recoveryPlans.id, plan.id)).returning();
      } else {
        const reason = !result.retryable ? `Non-retryable failure: ${result.message}` : plan.attemptsUsed >= plan.maxAttempts ? "Retry budget exhausted" : "Next attempt would exceed the deadline";
        await moveToDeadLetter(tx, ctx, plan, reason);
        [updatedPlan] = await tx.select().from(recoveryPlans).where(eq(recoveryPlans.id, plan.id));
      }
    }
    return { plan: updatedPlan, attempt: finished };
  });
  publishOrgEvent(ctx.organizationId, { type: "recovery.updated", id: out.plan.id, summary: out.plan.status });
  return out;
}

/** Async n8n callback: verified upstream; matched by attempt id + idempotency key within the integration's org. */
export async function recordRecoveryCallback(orgId: string, body: { attemptId: string; idempotencyKey: string; status: "succeeded" | "failed"; executionId?: string; message?: string; retryable?: boolean; durationMs?: number }) {
  const db = await getDb();
  const [attempt] = await db.select().from(recoveryAttempts).where(and(eq(recoveryAttempts.id, body.attemptId), eq(recoveryAttempts.organizationId, orgId)));
  if (!attempt || attempt.idempotencyKey !== body.idempotencyKey) throw new AppError("NOT_FOUND", "Unknown recovery attempt");
  if (attempt.status !== "started") return { duplicate: true, attemptId: attempt.id, status: attempt.status };
  const ctx = systemContext(orgId, undefined, "n8n");
  const result =
    body.status === "succeeded"
      ? { status: "succeeded" as const, executionId: body.executionId, message: body.message ?? "Recovered", durationMs: body.durationMs }
      : { status: "failed" as const, retryable: body.retryable ?? false, executionId: body.executionId, message: body.message ?? "Recovery failed", durationMs: body.durationMs };
  const out = await finalizeAttempt(ctx, attempt.id, result);
  return { duplicate: false, attemptId: attempt.id, status: out.attempt.status, planStatus: out.plan.status };
}

// ------------------------------------------------------------------ scheduler (cron)
/** Runs due backoff retries and enforces deadlines. Called by Vercel Cron / n8n schedule. */
export async function processDueRecoveries(now = new Date()) {
  const db = await getDb();
  const summary = { retried: 0, deadLettered: 0, stuck: 0, errors: 0 };

  const expired = await db.select().from(recoveryPlans).where(and(inArray(recoveryPlans.status, ["pending_approval", "approved"]), lte(recoveryPlans.deadlineAt, now))).limit(100);
  for (const plan of expired) {
    const ctx = systemContext(plan.organizationId, "cron");
    await db.transaction(async (tx) => {
      const locked = await loadPlanForUpdate(tx, ctx, plan.id);
      if (["pending_approval", "approved"].includes(locked.status)) {
        await moveToDeadLetter(tx, ctx, locked, locked.status === "pending_approval" ? "Approval not given before the deadline" : "Recovery deadline exceeded");
        summary.deadLettered++;
      }
    });
  }

  // Ambiguous outcomes (executor never answered) go to manual review rather than being retried blindly.
  const stuck = await db
    .select({ attempt: recoveryAttempts })
    .from(recoveryAttempts)
    .where(and(eq(recoveryAttempts.status, "started"), lte(recoveryAttempts.startedAt, new Date(now.getTime() - STUCK_EXECUTION_MS))))
    .limit(100);
  for (const { attempt } of stuck) {
    const ctx = systemContext(attempt.organizationId, "cron");
    await finalizeAttempt(ctx, attempt.id, { status: "failed", retryable: false, message: "No result from executor within 10 minutes (outcome unknown) — manual review required" });
    summary.stuck++;
  }

  const due = await db
    .select()
    .from(recoveryPlans)
    .where(and(eq(recoveryPlans.status, "approved"), sql`${recoveryPlans.attemptsUsed} > 0`, lte(recoveryPlans.nextAttemptAt, now)))
    .limit(50);
  for (const plan of due) {
    try {
      await executeRecoveryPlan(systemContext(plan.organizationId, "cron"), plan.id, { now });
      summary.retried++;
    } catch (e) {
      summary.errors++;
      logger.warn("scheduled retry failed", { planId: plan.id, reason: (e as Error).message });
    }
  }
  return summary;
}

// ------------------------------------------------------------------ queries
export async function listRecoveryPlans(ctx: ServiceContext, opts: { status?: RecoveryStatus[]; incidentId?: string; limit?: number } = {}) {
  authorize(ctx, "incident:read");
  const db = await getDb();
  return db
    .select({ plan: recoveryPlans, incidentNumber: incidents.number, incidentStatus: incidents.status, workflowName: workflows.name, sideEffectProfile: workflows.sideEffectProfile, requesterEmail: profiles.email })
    .from(recoveryPlans)
    .innerJoin(incidents, eq(recoveryPlans.incidentId, incidents.id))
    .innerJoin(workflows, eq(incidents.workflowId, workflows.id))
    .leftJoin(profiles, eq(recoveryPlans.createdBy, profiles.id))
    .where(
      and(
        eq(recoveryPlans.organizationId, ctx.organizationId),
        ...(opts.status?.length ? [inArray(recoveryPlans.status, opts.status)] : []),
        ...(opts.incidentId ? [eq(recoveryPlans.incidentId, opts.incidentId)] : []),
      ),
    )
    .orderBy(desc(recoveryPlans.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}

export async function getRecoveryPlan(ctx: ServiceContext, planId: string) {
  authorize(ctx, "incident:read");
  if (!/^[0-9a-f-]{36}$/i.test(planId)) throw new AppError("NOT_FOUND", "Recovery plan not found");
  const db = await getDb();
  const [plan] = await db.select().from(recoveryPlans).where(and(eq(recoveryPlans.id, planId), eq(recoveryPlans.organizationId, ctx.organizationId)));
  if (!plan) throw new AppError("NOT_FOUND", "Recovery plan not found");
  const [attempts, decisions] = await Promise.all([
    db.select().from(recoveryAttempts).where(eq(recoveryAttempts.recoveryPlanId, planId)).orderBy(recoveryAttempts.attemptNumber),
    db
      .select({ approval: approvals, email: profiles.email, fullName: profiles.fullName })
      .from(approvals)
      .innerJoin(profiles, eq(approvals.decidedBy, profiles.id))
      .where(eq(approvals.recoveryPlanId, planId)),
  ]);
  return { plan, attempts, approvals: decisions };
}

