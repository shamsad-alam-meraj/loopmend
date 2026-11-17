import type { Category, Criticality, RecoveryStrategy, RiskLevel, Role, Severity, SideEffectProfile } from "@schema";

export const RETRY_STRATEGIES: RecoveryStrategy[] = ["retry_execution", "exponential_backoff", "refresh_credentials_then_retry"];
/** Strategies that perform an action through the executor. */
export const EXECUTABLE_STRATEGIES: RecoveryStrategy[] = [...RETRY_STRATEGIES, "pause_workflow", "notify_owner"];

export const STRATEGY_INFO: Record<RecoveryStrategy, { label: string; description: string }> = {
  retry_execution: { label: "Retry execution", description: "Re-run the failed execution once." },
  exponential_backoff: { label: "Retry with backoff", description: "Bounded retries with exponential backoff and jitter." },
  refresh_credentials_then_retry: { label: "Refresh credentials, then retry", description: "Refresh the OAuth/API credential, then re-run." },
  pause_workflow: { label: "Pause workflow", description: "Deactivate the workflow to stop repeated failures." },
  notify_owner: { label: "Notify owner", description: "Send the diagnosis to the workflow owner for a fix." },
  manual_review: { label: "Manual review", description: "Hand off to a human via the dead-letter queue." },
};

export type PolicyInput = {
  strategy: RecoveryStrategy;
  requestedMaxAttempts?: number;
  workflow: { sideEffectProfile: SideEffectProfile; criticality: Criticality; autoRecoveryEnabled: boolean; status: string };
  incident: { category: Category; severity: Severity; occurrences: number; status: string };
  /** Model-reported confidence, informational only — never authorizes anything by itself. */
  aiConfidence?: number | null;
  /** Recovery attempts already made for this workflow in the last 24h (circuit breaker). */
  recentAttemptsForWorkflow: number;
};

export type PolicyCheck = { name: string; passed: boolean; detail: string };

export type PolicyDecision = {
  allowed: boolean;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  approverMinRole: Extract<Role, "operator" | "admin">;
  /** High-risk plans need a different person to approve than the one who requested them. */
  requiresSeparateApprover: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  deadlineMs: number;
  requiresSideEffectCheck: boolean;
  checks: PolicyCheck[];
  reasons: string[];
};

export const WORKFLOW_DAILY_ATTEMPT_BUDGET = 10;
export const MAX_ATTEMPTS_CAP = 5;

/**
 * Deterministic recovery policy (docs §10 "Non-negotiable recovery rules").
 * Pure function: same input → same decision. AI output can only *suggest* a
 * strategy; this code decides whether, how often and with whose approval it runs.
 */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { strategy, workflow, incident } = input;
  const checks: PolicyCheck[] = [];
  const reasons: string[] = [];
  const isRetry = RETRY_STRATEGIES.includes(strategy);
  const sideEffects = workflow.sideEffectProfile;
  const consequential = sideEffects === "financial" || sideEffects === "destructive";
  const retrySafe = sideEffects === "read_only" || sideEffects === "idempotent";

  checks.push({ name: "allowlisted_strategy", passed: strategy in STRATEGY_INFO, detail: `Strategy "${strategy}" is in the finite allowlist` });

  const incidentOpen = !["resolved", "dismissed"].includes(incident.status);
  checks.push({ name: "incident_active", passed: incidentOpen, detail: incidentOpen ? "Incident is still active" : `Incident is ${incident.status}` });

  const budgetOk = !isRetry || input.recentAttemptsForWorkflow < WORKFLOW_DAILY_ATTEMPT_BUDGET;
  checks.push({
    name: "workflow_retry_budget",
    passed: budgetOk,
    detail: `${input.recentAttemptsForWorkflow}/${WORKFLOW_DAILY_ATTEMPT_BUDGET} recovery attempts used for this workflow in 24h`,
  });

  const nonRetryable = isRetry && ["validation", "configuration", "data_quality"].includes(incident.category);
  checks.push({
    name: "failure_is_retryable",
    passed: !nonRetryable,
    detail: nonRetryable ? `${incident.category} failures will fail again without a fix` : "Failure class can plausibly succeed on retry",
  });

  const workflowArchived = workflow.status === "archived";
  checks.push({ name: "workflow_not_archived", passed: !workflowArchived, detail: `Workflow status: ${workflow.status}` });

  // ---- risk
  let riskLevel: RiskLevel = "low";
  if (strategy === "pause_workflow" || strategy === "refresh_credentials_then_retry") riskLevel = "medium";
  if (isRetry && sideEffects === "non_idempotent") riskLevel = "medium";
  if (isRetry && consequential) riskLevel = "high";
  if (strategy === "pause_workflow" && (workflow.criticality === "critical" || workflow.criticality === "high")) riskLevel = "high";
  if (incident.severity === "critical" && riskLevel === "low" && isRetry) riskLevel = "medium";

  // ---- attempts
  let maxAttempts = 0;
  if (isRetry) {
    const requested = input.requestedMaxAttempts ?? (strategy === "exponential_backoff" ? 3 : 1);
    maxAttempts = Math.max(1, Math.min(requested, MAX_ATTEMPTS_CAP));
    if (!retrySafe) {
      maxAttempts = 1;
      reasons.push(`${sideEffects} workflow: limited to a single attempt`);
    }
    if (strategy === "retry_execution") maxAttempts = 1;
  } else if (strategy === "pause_workflow" || strategy === "notify_owner") {
    maxAttempts = 1;
  }

  // ---- approval
  const autoEligible =
    workflow.autoRecoveryEnabled && retrySafe && riskLevel === "low" && (strategy === "exponential_backoff" || strategy === "retry_execution" || strategy === "notify_owner") && incident.severity !== "critical";
  const requiresApproval = !autoEligible;
  if (autoEligible) reasons.push("Low-risk recovery on a retry-safe workflow with auto-recovery enabled: no approval required");
  else if (consequential && isRetry) reasons.push(`${sideEffects} workflow: never retried automatically; admin approval and a second approver required`);
  else reasons.push(`Approval required (${riskLevel} risk${workflow.autoRecoveryEnabled ? "" : ", auto-recovery disabled"})`);
  if (input.aiConfidence !== undefined && input.aiConfidence !== null) reasons.push(`AI confidence ${Math.round(input.aiConfidence * 100)}% is informational only`);

  const approverMinRole = riskLevel === "high" ? "admin" : "operator";
  const requiresSideEffectCheck = isRetry && !retrySafe;
  if (requiresSideEffectCheck) reasons.push("Side-effect check runs before every attempt");

  const allowed = checks.every((c) => c.passed);
  if (!allowed) reasons.unshift(`Blocked: ${checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}`);

  return {
    allowed,
    riskLevel,
    requiresApproval,
    approverMinRole,
    requiresSeparateApprover: riskLevel === "high",
    maxAttempts,
    baseDelayMs: strategy === "exponential_backoff" ? (incident.category === "rate_limit" ? 5_000 : 2_000) : 1_000,
    deadlineMs: (strategy === "exponential_backoff" ? 30 : 60) * 60_000,
    requiresSideEffectCheck,
    checks,
    reasons,
  };
}
