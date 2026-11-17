/**
 * Lightweight, explainable anomaly detection on execution metrics.
 *
 * For each workflow we compare the most recent window against a trailing
 * baseline built from hourly buckets:
 *   - failure-rate spike: z-score of the recent failure rate vs. the
 *     baseline hourly failure-rate distribution (with a binomial floor on σ
 *     so quiet workflows don't alarm on a single failure)
 *   - latency regression: recent p95 vs. baseline median-of-hourly-p95,
 *     using a robust MAD-based z-score
 *   - silence: a normally busy workflow that stopped running
 */
export type HourBucket = { hour: string; runs: number; failures: number; p95Ms: number | null };

export type Anomaly = {
  kind: "failure_spike" | "latency_regression" | "silence";
  severity: "warning" | "critical";
  score: number;
  observed: number;
  expected: number;
  message: string;
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function detectAnomalies(baseline: HourBucket[], recent: HourBucket[], opts: { recentHours: number }): Anomaly[] {
  const out: Anomaly[] = [];
  const baseRuns = baseline.reduce((s, b) => s + b.runs, 0);
  const recentRuns = recent.reduce((s, b) => s + b.runs, 0);
  const recentFailures = recent.reduce((s, b) => s + b.failures, 0);
  if (baseRuns < 20) return out; // not enough history to say anything honest

  // ---- failure-rate spike
  const rates = baseline.filter((b) => b.runs > 0).map((b) => b.failures / b.runs);
  const baseRate = baseline.reduce((s, b) => s + b.failures, 0) / baseRuns;
  if (recentRuns >= 3) {
    const recentRate = recentFailures / recentRuns;
    const binomialSigma = Math.sqrt(Math.max(baseRate * (1 - baseRate), 0.0025) / recentRuns);
    const sigma = Math.max(std(rates) / Math.sqrt(Math.max(1, recent.length)), binomialSigma);
    const z = (recentRate - baseRate) / sigma;
    if (z >= 3 && recentFailures >= 2 && recentRate - baseRate >= 0.05) {
      out.push({
        kind: "failure_spike",
        severity: z >= 6 || recentRate >= 0.3 ? "critical" : "warning",
        score: Math.round(z * 10) / 10,
        observed: recentRate,
        expected: baseRate,
        message: `Failure rate ${(recentRate * 100).toFixed(1)}% over the last ${opts.recentHours}h vs ${(baseRate * 100).toFixed(1)}% baseline (z=${z.toFixed(1)})`,
      });
    }
  }

  // ---- latency regression (robust z on hourly p95)
  const baseP95s = baseline.map((b) => b.p95Ms).filter((v): v is number => v !== null);
  const recentP95s = recent.map((b) => b.p95Ms).filter((v): v is number => v !== null);
  if (baseP95s.length >= 12 && recentP95s.length >= 1) {
    const med = median(baseP95s);
    const mad = median(baseP95s.map((v) => Math.abs(v - med))) * 1.4826 || med * 0.1;
    const observed = median(recentP95s);
    const z = (observed - med) / mad;
    if (z >= 3.5 && observed >= med * 1.5) {
      out.push({
        kind: "latency_regression",
        severity: observed >= med * 3 ? "critical" : "warning",
        score: Math.round(z * 10) / 10,
        observed,
        expected: med,
        message: `p95 latency ${Math.round(observed)}ms vs ${Math.round(med)}ms baseline (${(observed / med).toFixed(1)}×)`,
      });
    }
  }

  // ---- silence: expected ≥ 6 runs in the window but saw none
  const expectedRuns = (baseRuns / Math.max(1, baseline.length)) * opts.recentHours;
  if (expectedRuns >= 6 && recentRuns === 0) {
    out.push({ kind: "silence", severity: "warning", score: expectedRuns, observed: 0, expected: expectedRuns, message: `No executions in the last ${opts.recentHours}h (expected ~${Math.round(expectedRuns)})` });
  }
  return out;
}

/** Error budget for an availability SLO (fraction of allowed failures still unused). */
export function errorBudget(runs: number, failures: number, target: number) {
  if (runs === 0) return { allowedFailures: 0, consumed: 0, remaining: 1 };
  const allowed = runs * (1 - target);
  const consumed = allowed > 0 ? failures / allowed : failures > 0 ? Infinity : 0;
  return { allowedFailures: allowed, consumed, remaining: Math.max(0, 1 - consumed) };
}

export const SLO_TARGETS = { critical: 0.995, high: 0.99, medium: 0.98, low: 0.95 } as const;
