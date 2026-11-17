import { describe, expect, it } from "vitest";
import { detectAnomalies, errorBudget, type HourBucket } from "@/lib/analytics/anomaly";

const hours = (n: number, f: (i: number) => Omit<HourBucket, "hour">): HourBucket[] => Array.from({ length: n }, (_, i) => ({ hour: `h${i}`, ...f(i) }));
const baseline = hours(7 * 24, (i) => ({ runs: 4, failures: i % 25 === 0 ? 1 : 0, p95Ms: 5000 + (i % 7) * 100 }));

describe("anomaly detection", () => {
  it("is quiet when recent behaviour matches the baseline", () => {
    expect(detectAnomalies(baseline, hours(6, () => ({ runs: 4, failures: 0, p95Ms: 5200 })), { recentHours: 6 })).toEqual([]);
  });
  it("flags failure-rate spikes", () => {
    const a = detectAnomalies(baseline, hours(6, () => ({ runs: 4, failures: 2, p95Ms: 5200 })), { recentHours: 6 });
    expect(a.map((x) => x.kind)).toContain("failure_spike");
    expect(a.find((x) => x.kind === "failure_spike")!.severity).toBe("critical");
  });
  it("does not alarm on a single failure in a quiet workflow", () => {
    expect(detectAnomalies(baseline, hours(6, (i) => ({ runs: 4, failures: i === 0 ? 1 : 0, p95Ms: 5100 })), { recentHours: 6 })).toEqual([]);
  });
  it("flags latency regressions robustly and detects silence", () => {
    const slow = detectAnomalies(baseline, hours(6, () => ({ runs: 4, failures: 0, p95Ms: 15000 })), { recentHours: 6 });
    expect(slow.map((x) => x.kind)).toEqual(["latency_regression"]);
    const silent = detectAnomalies(baseline, [], { recentHours: 6 });
    expect(silent.map((x) => x.kind)).toEqual(["silence"]);
  });
  it("needs enough history", () => {
    expect(detectAnomalies(hours(3, () => ({ runs: 1, failures: 0, p95Ms: 1 })), hours(6, () => ({ runs: 4, failures: 4, p95Ms: 1 })), { recentHours: 6 })).toEqual([]);
  });
  it("computes error budgets", () => {
    const b = errorBudget(1000, 5, 0.99);
    expect(b.allowedFailures).toBeCloseTo(10);
    expect(b.consumed).toBeCloseTo(0.5);
    expect(b.remaining).toBeCloseTo(0.5);
    expect(errorBudget(1000, 20, 0.99).remaining).toBe(0);
    expect(errorBudget(0, 0, 0.99).remaining).toBe(1);
  });
});
