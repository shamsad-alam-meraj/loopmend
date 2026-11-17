import type { Category, RecoveryStrategy } from "@schema";
import { classifyError, deriveSeverity } from "@/lib/incidents/classifier";
import type { AiClassification, Investigation } from "../schemas/investigation.schema";
import type { InvestigationContext } from "../types";

/**
 * Deterministic, explainable investigation engine. Used when no AI provider
 * is configured, when the provider fails, or when its output is invalid.
 */
export const RULES_ENGINE = { name: "rules", model: "loopmend-rules", version: "rules@1" } as const;

export function rulesClassify(ctx: InvestigationContext): AiClassification {
  const c = classifyError({ code: ctx.incident.errorCode, message: ctx.incident.errorMessage, httpStatus: ctx.incident.httpStatus, node: ctx.incident.failedNode });
  const category = c.category === "unknown" ? ctx.incident.preliminaryCategory : c.category;
  return {
    category,
    severity: deriveSeverity(category, ctx.workflow.criticality, ctx.incident.occurrences),
    rationale: c.evidence.join("; "),
  };
}

const SUMMARY: Record<Category, string> = {
  rate_limit: "External API rate limit exceeded",
  authentication: "Credential or access token rejected by the external service",
  network: "Transient network failure reaching the external service",
  timeout: "Operation exceeded its time limit",
  validation: "Input data failed validation",
  upstream_outage: "Upstream service returned server errors",
  configuration: "Workflow configuration or credential is missing",
  data_quality: "Unexpected data shape or constraint violation",
  resource_exhausted: "A resource limit (memory, disk, payload size) was exhausted",
  unknown: "Failure cause could not be determined from available evidence",
};

function strategyFor(category: Category, ctx: InvestigationContext): { strategy: RecoveryStrategy; maxAttempts: number; rationale: string } {
  const sideEffects = ctx.workflow.sideEffectProfile;
  const risky = sideEffects === "financial" || sideEffects === "destructive";
  const retrySafe = sideEffects === "idempotent" || sideEffects === "read_only";
  const sustained = ctx.executionStats.runs >= 5 && ctx.executionStats.failures / ctx.executionStats.runs >= 0.5;
  if (risky) return { strategy: "manual_review", maxAttempts: 0, rationale: `${sideEffects} side effects: never retried automatically` };
  if ((category === "upstream_outage" || category === "network") && sustained && ctx.incident.occurrences >= 5)
    return { strategy: "pause_workflow", maxAttempts: 0, rationale: "Sustained failures; pausing avoids repeated partial side effects" };
  switch (category) {
    case "rate_limit":
      return { strategy: "exponential_backoff", maxAttempts: 3, rationale: "Rate limits are transient; back off with jitter" };
    case "timeout":
    case "network":
    case "upstream_outage":
      return retrySafe
        ? { strategy: "exponential_backoff", maxAttempts: 3, rationale: "Transient failure on a retry-safe workflow" }
        : { strategy: "retry_execution", maxAttempts: 1, rationale: "Transient failure, but the workflow is not idempotent: one approved retry after a side-effect check" };
    case "authentication":
      return { strategy: "refresh_credentials_then_retry", maxAttempts: 1, rationale: "Expired or rejected credential" };
    case "validation":
    case "data_quality":
    case "configuration":
      return { strategy: "notify_owner", maxAttempts: 0, rationale: "Requires a data or configuration fix; retrying will fail again" };
    default:
      return { strategy: "manual_review", maxAttempts: 0, rationale: "Insufficient evidence for an automated strategy" };
  }
}

export function rulesInvestigate(ctx: InvestigationContext, classification: AiClassification): Investigation {
  const c = classifyError({ code: ctx.incident.errorCode, message: ctx.incident.errorMessage, httpStatus: ctx.incident.httpStatus, node: ctx.incident.failedNode });
  const s = ctx.executionStats;
  const evidence = [...c.evidence];
  if (ctx.incident.occurrences > 1) evidence.push(`Same error signature seen ${ctx.incident.occurrences} times since ${ctx.incident.firstSeenAt}`);
  if (s.runs > 0) evidence.push(`${s.failures} of ${s.runs} executions failed in the ${s.window}`);
  if (s.p95Ms && s.baselineP95Ms && s.p95Ms > s.baselineP95Ms * 1.5) evidence.push(`p95 latency ${Math.round(s.p95Ms)}ms vs ${Math.round(s.baselineP95Ms)}ms baseline`);
  const prior = ctx.relatedIncidents.filter((r) => r.sameSignature);
  if (prior.length) evidence.push(`${prior.length} prior incident(s) with the same signature (${prior.map((p) => p.ref).join(", ")})`);

  const rec = strategyFor(classification.category, ctx);
  const known = classification.category !== "unknown";
  const confidence = Math.min(0.9, (known ? 0.6 : 0.3) + (c.evidence.length > 1 ? 0.1 : 0) + (prior.length ? 0.1 : 0) + (ctx.incident.occurrences > 2 ? 0.05 : 0));
  return {
    category: classification.category,
    severity: classification.severity,
    rootCause: { summary: SUMMARY[classification.category], evidence: evidence.slice(0, 6) },
    recommendation: { strategy: rec.strategy, requiresApproval: true, maxAttempts: rec.maxAttempts, rationale: rec.rationale },
    confidence: Math.round(confidence * 100) / 100,
    caveats: ["Deterministic rules analysis: no model was consulted", ...(known ? [] : ["No known error signature matched"])],
  };
}
