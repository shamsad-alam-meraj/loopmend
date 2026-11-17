import { describe, expect, it } from "vitest";
import { evaluatePolicy, type PolicyInput } from "@/lib/recovery/policy";
import { backoffDelayMs, nextAttemptAt } from "@/lib/recovery/backoff";

const base: PolicyInput = {
  strategy: "exponential_backoff",
  workflow: { sideEffectProfile: "idempotent", criticality: "medium", autoRecoveryEnabled: true, status: "active" },
  incident: { category: "rate_limit", severity: "medium", occurrences: 1, status: "open" },
  recentAttemptsForWorkflow: 0,
};

describe("recovery policy", () => {
  it("auto-approves low-risk backoff on retry-safe workflows with auto-recovery", () => {
    const d = evaluatePolicy(base);
    expect(d).toMatchObject({ allowed: true, riskLevel: "low", requiresApproval: false, maxAttempts: 3, requiresSideEffectCheck: false });
  });
  it("requires approval when auto-recovery is disabled or severity is critical", () => {
    expect(evaluatePolicy({ ...base, workflow: { ...base.workflow, autoRecoveryEnabled: false } }).requiresApproval).toBe(true);
    expect(evaluatePolicy({ ...base, incident: { ...base.incident, severity: "critical" } }).requiresApproval).toBe(true);
  });
  it("limits non-idempotent workflows to one approved attempt with a side-effect check", () => {
    const d = evaluatePolicy({ ...base, workflow: { ...base.workflow, sideEffectProfile: "non_idempotent" } });
    expect(d).toMatchObject({ riskLevel: "medium", requiresApproval: true, maxAttempts: 1, requiresSideEffectCheck: true, approverMinRole: "operator" });
  });
  it("never auto-retries financial/destructive work: high risk, admin, four-eyes", () => {
    for (const profile of ["financial", "destructive"] as const) {
      const d = evaluatePolicy({ ...base, workflow: { ...base.workflow, sideEffectProfile: profile, autoRecoveryEnabled: true } });
      expect(d).toMatchObject({ riskLevel: "high", requiresApproval: true, approverMinRole: "admin", requiresSeparateApprover: true, maxAttempts: 1 });
    }
  });
  it("blocks retries of non-transient failures and exhausted budgets", () => {
    expect(evaluatePolicy({ ...base, incident: { ...base.incident, category: "validation" } }).allowed).toBe(false);
    expect(evaluatePolicy({ ...base, recentAttemptsForWorkflow: 10 }).allowed).toBe(false);
    expect(evaluatePolicy({ ...base, incident: { ...base.incident, status: "resolved" } }).allowed).toBe(false);
    expect(evaluatePolicy({ ...base, strategy: "notify_owner", incident: { ...base.incident, category: "validation" } }).allowed).toBe(true);
  });
  it("caps attempts and keeps AI confidence informational", () => {
    expect(evaluatePolicy({ ...base, requestedMaxAttempts: 50 }).maxAttempts).toBe(5);
    const d = evaluatePolicy({ ...base, workflow: { ...base.workflow, autoRecoveryEnabled: false }, aiConfidence: 0.99 });
    expect(d.requiresApproval).toBe(true);
    expect(d.reasons.join(" ")).toMatch(/informational only/);
  });
});

describe("backoff", () => {
  it("grows exponentially with full jitter and respects the cap", () => {
    const max = (attempt: number) => backoffDelayMs(attempt, { baseMs: 1000, capMs: 10_000, random: () => 0.999999 });
    expect(max(1)).toBeLessThanOrEqual(1000);
    expect(max(2)).toBeLessThanOrEqual(2000);
    expect(max(3)).toBeLessThanOrEqual(4000);
    expect(max(10)).toBeLessThanOrEqual(10_000);
    expect(backoffDelayMs(3, { baseMs: 1000, random: () => 0 })).toBe(500);
  });
  it("never schedules past the deadline", () => {
    const now = new Date("2026-11-17T10:00:00Z");
    expect(nextAttemptAt(now, 1, { baseMs: 60_000, deadline: new Date(now.getTime() + 1000), random: () => 1 })).toBeNull();
  });
});
