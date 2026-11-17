import "server-only";
import { randomBytes } from "node:crypto";
import type { Category, RecoveryStrategy } from "@schema";
import { HEADER, signPayload } from "@/lib/n8n/signing";

export type RecoveryRequest = {
  planId: string;
  attemptId: string;
  attemptNumber: number;
  idempotencyKey: string;
  strategy: RecoveryStrategy;
  organizationId: string;
  workflow: { externalId: string; name: string };
  originalExecutionId: string | null;
  incident: { id: string; number: number; category: Category };
  deadline: string;
};

export type RecoveryResult =
  | { status: "succeeded"; executionId?: string; message: string; durationMs?: number }
  | { status: "failed"; retryable: boolean; message: string; executionId?: string; durationMs?: number }
  /** The executor accepted the job and will report the outcome via the signed callback. */
  | { status: "accepted"; message: string };

export interface RecoveryExecutor {
  readonly name: string;
  execute(req: RecoveryRequest): Promise<RecoveryResult>;
}

/**
 * Calls the n8n "recovery-executor" webhook with a signed request. n8n
 * validates the signature, checks the idempotency key, executes the approved
 * action and either responds synchronously or calls back
 * /api/v1/webhooks/n8n/recovery.
 */
export class N8nRecoveryExecutor implements RecoveryExecutor {
  readonly name = "n8n";
  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly integrationId: string,
  ) {}
  async execute(req: RecoveryRequest): Promise<RecoveryResult> {
    const body = JSON.stringify({ type: "recovery.execute", ...req });
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", [HEADER.integration]: this.integrationId, [HEADER.idempotency]: req.idempotencyKey, ...signPayload(this.secret, body) },
        body,
        signal: AbortSignal.timeout(25_000),
      });
    } catch (e) {
      // Unknown outcome: n8n may or may not have run it. Treated as retryable only
      // because the attempt carries an idempotency key n8n deduplicates on.
      return { status: "failed", retryable: true, message: `n8n unreachable: ${(e as Error).message}`, durationMs: Date.now() - started };
    }
    const json = (await res.json().catch(() => ({}))) as { status?: string; executionId?: string; message?: string };
    if (res.status === 202 || json.status === "accepted") return { status: "accepted", message: json.message ?? "Accepted by n8n" };
    if (res.ok && json.status !== "failed") return { status: "succeeded", executionId: json.executionId, message: json.message ?? "Recovered", durationMs: Date.now() - started };
    return { status: "failed", retryable: res.status >= 500 || res.status === 429, executionId: json.executionId, message: json.message ?? `n8n responded with HTTP ${res.status}`, durationMs: Date.now() - started };
  }
}

/**
 * Demo executor: deterministic, clearly-labeled simulated outcomes so the full
 * lifecycle can be shown without a live n8n instance. Rate-limited retries fail
 * once (to demonstrate backoff), validation failures never recover.
 */
export class SimulatedRecoveryExecutor implements RecoveryExecutor {
  readonly name = "simulator";
  async execute(req: RecoveryRequest): Promise<RecoveryResult> {
    const executionId = `sim_recovery_${randomBytes(5).toString("hex")}`;
    const durationMs = 600 + Math.round(Math.random() * 900);
    switch (req.strategy) {
      case "pause_workflow":
        return { status: "succeeded", message: `[simulated] Workflow "${req.workflow.name}" deactivated`, durationMs };
      case "notify_owner":
        return { status: "succeeded", message: `[simulated] Diagnosis sent to the owner of "${req.workflow.name}"`, durationMs };
      default:
        if (["validation", "data_quality", "configuration"].includes(req.incident.category)) {
          return { status: "failed", retryable: false, executionId, message: "[simulated] Re-run failed with the same input error", durationMs };
        }
        if (req.incident.category === "rate_limit" && req.attemptNumber === 1 && req.strategy === "exponential_backoff") {
          return { status: "failed", retryable: true, executionId, message: "[simulated] HTTP 429: still rate limited, backing off", durationMs };
        }
        return { status: "succeeded", executionId, message: `[simulated] Re-run of ${req.originalExecutionId ?? "execution"} succeeded`, durationMs };
    }
  }
}
