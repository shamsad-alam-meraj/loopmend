import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@schema";
import { createTestDb } from "../support/db";
import { seedDemo } from "@/lib/db/seed";
import { sha256Hex } from "@/lib/security/crypto";
import { ingestEvent } from "@/services/ingestion.service";
import { systemContext, type ServiceContext } from "@/services/context";
import { investigateIncident } from "@/services/investigation.service";
import "@/services/hooks";
import {
  __setRecoveryExecutor,
  createRecoveryPlan,
  decideRecoveryPlan,
  executeRecoveryPlan,
  getRecoveryPlan,
  processDueRecoveries,
  recordRecoveryCallback,
} from "@/services/recovery.service";
import { __setAiProvider } from "@/lib/ai/ai.service";
import type { RecoveryExecutor, RecoveryRequest, RecoveryResult } from "@/lib/recovery/executor";
import type { Db } from "@/lib/db/client";

let db: Db;
let close: () => Promise<void>;
let ids: Awaited<ReturnType<typeof seedDemo>>;
const as = (email: string, role: ServiceContext["role"]): ServiceContext => ({ organizationId: ids.acme, actor: { type: "user", id: ids.userIds.get(email)! }, role });
let owner: ServiceContext, admin: ServiceContext, operator: ServiceContext, viewer: ServiceContext;

class CountingExecutor implements RecoveryExecutor {
  readonly name = "test";
  calls: RecoveryRequest[] = [];
  constructor(private script: (req: RecoveryRequest) => RecoveryResult | Promise<RecoveryResult>) {}
  async execute(req: RecoveryRequest) {
    this.calls.push(req);
    return this.script(req);
  }
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  ids = await seedDemo(db, Date.now(), { days: 3 });
  owner = as("owner@demo.loopmend.dev", "owner");
  admin = as("admin@demo.loopmend.dev", "admin");
  operator = as("operator@demo.loopmend.dev", "operator");
  viewer = as("viewer@demo.loopmend.dev", "viewer");
  __setAiProvider(null); // deterministic rules engine
});
afterAll(async () => close());
afterEach(() => __setRecoveryExecutor(undefined));

let n = 0;
async function incidentFor(workflowExternalId: string, message: string, code: string) {
  n++;
  const [wf] = await db.select().from(schema.workflows).where(and(eq(schema.workflows.organizationId, ids.acme), eq(schema.workflows.externalId, workflowExternalId)));
  const event = {
    event: "workflow.execution.failed" as const,
    eventId: `evt_rec_${n}`,
    source: "n8n" as const,
    workflow: { id: wf.externalId, name: wf.name },
    execution: { id: `exec_rec_${n}`, status: "error" as const, durationMs: 900, error: { code: `${code}_${n}`, message, node: "Node" } },
    occurredAt: new Date().toISOString(),
  };
  return (await ingestEvent(systemContext(ids.acme), event, { payloadHash: sha256Hex(JSON.stringify(event)) })).incidentId!;
}
const incidentStatus = async (id: string) => (await db.select().from(schema.incidents).where(eq(schema.incidents.id, id)))[0].status;

describe("human-in-the-loop recovery", () => {
  it("investigation proposes a plan that waits for approval; viewers cannot act", async () => {
    const executor = new CountingExecutor(() => ({ status: "succeeded", executionId: `ok_${n}`, message: "re-run ok" }));
    __setRecoveryExecutor(executor);
    const incidentId = await incidentFor("wf_payment_notification", "ETIMEDOUT after 30000ms", "ETIMEDOUT");
    await investigateIncident(operator, incidentId);
    const [plan] = await db.select().from(schema.recoveryPlans).where(eq(schema.recoveryPlans.incidentId, incidentId));
    expect(plan).toMatchObject({ status: "pending_approval", strategy: "retry_execution", riskLevel: "medium", maxAttempts: 1 });
    expect(await incidentStatus(incidentId)).toBe("awaiting_approval");

    await expect(decideRecoveryPlan(viewer, plan.id, "approved")).rejects.toThrow(/cannot perform recovery:approve/);
    await expect(executeRecoveryPlan(operator, plan.id)).rejects.toThrow(/requires approval/);
    expect(executor.calls).toHaveLength(0);

    await decideRecoveryPlan(operator, plan.id, "approved", "safe to retry once");
    await expect(decideRecoveryPlan(admin, plan.id, "approved")).rejects.toThrow(/only pending plans/);

    const out = await executeRecoveryPlan(operator, plan.id);
    expect(out.plan.status).toBe("succeeded");
    expect(await incidentStatus(incidentId)).toBe("resolved");

    // Duplicate request: no duplicate side effect.
    const again = await executeRecoveryPlan(operator, plan.id);
    expect(again.duplicate).toBe(true);
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].idempotencyKey).toMatch(/:attempt:1$/);

    // Complete, append-only audit trail of decision and outcome.
    const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, plan.id));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["recovery.plan_created", "recovery.approved", "recovery.execution_requested", "recovery.succeeded"]));
    const recoveryExec = await db.select().from(schema.executions).where(eq(schema.executions.externalId, executor.calls[0] && `ok_${n}`));
    expect(recoveryExec[0]?.recoveryAttemptId).toBeTruthy();
  });

  it("serializes concurrent execute requests into a single attempt", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const executor = new CountingExecutor(async () => {
      await gate;
      return { status: "succeeded", message: "ok" };
    });
    __setRecoveryExecutor(executor);
    const incidentId = await incidentFor("wf_customer_onboarding", "HTTP 503: Service Unavailable", "UPSTREAM_503");
    const { plan } = await createRecoveryPlan(operator, { incidentId, strategy: "retry_execution" });
    await decideRecoveryPlan(admin, plan.id, "approved");
    const results = Promise.allSettled([executeRecoveryPlan(operator, plan.id), executeRecoveryPlan(operator, plan.id), executeRecoveryPlan(admin, plan.id)]);
    await new Promise((r) => setTimeout(r, 200));
    release();
    const settled = await results;
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((s) => s.status === "rejected").map((s) => String((s as PromiseRejectedResult).reason.message))).toEqual(
      expect.arrayContaining([expect.stringMatching(/already in progress|succeeded|Plan is/)]),
    );
    expect(executor.calls).toHaveLength(1);
  });

  it("backs off between retryable failures and dead-letters on exhaustion", async () => {
    const executor = new CountingExecutor(() => ({ status: "failed", retryable: true, message: "HTTP 429 again" }));
    __setRecoveryExecutor(executor);
    // Inventory Sync: idempotent + auto-recovery → policy auto-approves and runs attempt 1 immediately.
    const incidentId = await incidentFor("wf_inventory_sync", "HTTP 429: Too Many Requests", "RATE_LIMITED");
    const { plan } = await createRecoveryPlan(operator, { incidentId, strategy: "exponential_backoff" });
    expect(plan.requiresApproval).toBe(false);
    expect(executor.calls).toHaveLength(1);
    let detail = await getRecoveryPlan(operator, plan.id);
    expect(detail.plan).toMatchObject({ status: "approved", attemptsUsed: 1 });
    expect(detail.plan.nextAttemptAt).toBeTruthy();
    await expect(executeRecoveryPlan(operator, plan.id)).rejects.toThrow(/Backoff in effect/);

    for (let i = 1; i <= 3; i++) await processDueRecoveries(new Date(Date.now() + i * 5 * 60_000));
    detail = await getRecoveryPlan(operator, plan.id);
    expect(executor.calls).toHaveLength(3);
    expect(detail.plan.status).toBe("dead_letter");
    expect(detail.plan.deadLetterReason).toMatch(/budget exhausted/);
    expect(await incidentStatus(incidentId)).toBe("dead_letter");
    expect(new Set(detail.attempts.map((a) => a.idempotencyKey)).size).toBe(3);
  });

  it("dead-letters non-retryable failures immediately", async () => {
    __setRecoveryExecutor(new CountingExecutor(() => ({ status: "failed", retryable: false, message: "schema mismatch" })));
    const incidentId = await incidentFor("wf_inventory_sync", "socket hang up (ECONNRESET)", "ECONNRESET");
    const { plan } = await createRecoveryPlan(operator, { incidentId, strategy: "exponential_backoff" });
    expect((await getRecoveryPlan(operator, plan.id)).plan.status).toBe("dead_letter");
  });

  it("enforces admin + four-eyes approval for financial workflows", async () => {
    __setRecoveryExecutor(new CountingExecutor(() => ({ status: "succeeded", message: "ok" })));
    const incidentId = await incidentFor("wf_invoice_generator", "HTTP 502: Bad Gateway", "UPSTREAM_502");
    const { plan } = await createRecoveryPlan(admin, { incidentId, strategy: "retry_execution" });
    expect(plan).toMatchObject({ riskLevel: "high", requiresApproval: true, maxAttempts: 1 });
    await expect(decideRecoveryPlan(operator, plan.id, "approved")).rejects.toThrow(/admin or owner/);
    await expect(decideRecoveryPlan(admin, plan.id, "approved")).rejects.toThrow(/cannot approve a plan you requested/);
    const approved = await decideRecoveryPlan(owner, plan.id, "approved");
    expect(approved.status).toBe("approved");
  });

  it("rejects policy violations and honours idempotency keys", async () => {
    const incidentId = await incidentFor("wf_customer_onboarding", "Field 'email' is required but was empty", "VALIDATION_ERROR");
    await expect(createRecoveryPlan(operator, { incidentId, strategy: "exponential_backoff" })).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
    const a = await createRecoveryPlan(operator, { incidentId, strategy: "notify_owner", idempotencyKey: "client-key-123" });
    const b = await createRecoveryPlan(operator, { incidentId, strategy: "notify_owner", idempotencyKey: "client-key-123" });
    expect(b.duplicate).toBe(true);
    expect(b.plan.id).toBe(a.plan.id);
    await expect(createRecoveryPlan(operator, { incidentId, strategy: "pause_workflow" })).rejects.toThrow(/already has an active/);
  });

  it("skips the retry when the side effect already happened", async () => {
    const executor = new CountingExecutor(() => ({ status: "succeeded", message: "should not run" }));
    __setRecoveryExecutor(executor);
    const incidentId = await incidentFor("wf_payment_notification", "socket hang up (ECONNRESET)", "ECONNRESET");
    const [inc] = await db.select({ e: schema.executions }).from(schema.incidents).innerJoin(schema.executions, eq(schema.incidents.executionId, schema.executions.id)).where(eq(schema.incidents.id, incidentId));
    await db.insert(schema.executions).values({ organizationId: ids.acme, workflowId: inc.e.workflowId, externalId: `n8n_retry_${n}`, status: "success", metadata: { retryOf: inc.e.externalId } });
    const { plan } = await createRecoveryPlan(operator, { incidentId, strategy: "retry_execution" });
    await decideRecoveryPlan(admin, plan.id, "approved");
    const out = await executeRecoveryPlan(operator, plan.id);
    expect(out.plan.status).toBe("succeeded");
    expect(executor.calls).toHaveLength(0);
    expect(out.result && "message" in out.result ? out.result.message : "").toMatch(/Side-effect check/);
  });

  it("records async results from the n8n callback exactly once", async () => {
    const executor = new CountingExecutor(() => ({ status: "accepted", message: "queued in n8n" }));
    __setRecoveryExecutor(executor);
    const incidentId = await incidentFor("wf_customer_onboarding", "HTTP 503: Service Unavailable", "UPSTREAM_503");
    const { plan } = await createRecoveryPlan(operator, { incidentId, strategy: "retry_execution" });
    await decideRecoveryPlan(admin, plan.id, "approved");
    const out = await executeRecoveryPlan(operator, plan.id);
    expect(out.plan.status).toBe("executing");
    const req = executor.calls[0];
    await expect(recordRecoveryCallback(ids.globex, { attemptId: req.attemptId, idempotencyKey: req.idempotencyKey, status: "succeeded" })).rejects.toThrow(/Unknown/);
    const first = await recordRecoveryCallback(ids.acme, { attemptId: req.attemptId, idempotencyKey: req.idempotencyKey, status: "succeeded", executionId: "n8n_cb_1" });
    expect(first).toMatchObject({ duplicate: false, planStatus: "succeeded" });
    const second = await recordRecoveryCallback(ids.acme, { attemptId: req.attemptId, idempotencyKey: req.idempotencyKey, status: "failed" });
    expect(second.duplicate).toBe(true);
  });

  it("dead-letters plans whose approval deadline passes", async () => {
    const incidentId = await incidentFor("wf_customer_onboarding", "HTTP 503: Service Unavailable", "UPSTREAM_503");
    const { plan } = await createRecoveryPlan(operator, { incidentId, strategy: "retry_execution" });
    const summary = await processDueRecoveries(new Date(Date.now() + 2 * 3_600_000));
    expect(summary.deadLettered).toBeGreaterThanOrEqual(1);
    const detail = await getRecoveryPlan(operator, plan.id);
    expect(detail.plan).toMatchObject({ status: "dead_letter", deadLetterReason: "Approval not given before the deadline" });
  });
});
