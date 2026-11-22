/**
 * Repeatable ingestion benchmark against a running Loopmend instance.
 *
 *   BENCH_URL=http://127.0.0.1:3400 BENCH_INTEGRATION_ID=… BENCH_SECRET=… \
 *   npx tsx infrastructure/scripts/benchmark.ts [--events 2000] [--concurrency 20] [--duplicates 50] [--out file.json]
 *
 * Measures (all from real HTTP round trips through signature verification,
 * replay protection, normalization and the idempotent ingestion transaction):
 *   - throughput (events/s) and latency percentiles for unique events
 *   - ingestion delay: event occurredAt → incident persisted (response received)
 *   - duplicate behaviour: N concurrent deliveries of one event → incidents created
 */
import { createHmac, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import os from "node:os";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : null;
const BASE = (process.env.BENCH_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const INTEGRATION = process.env.BENCH_INTEGRATION_ID ?? "";
const SECRET = process.env.BENCH_SECRET ?? "";
const EVENTS = arg("events", 2000);
const CONCURRENCY = arg("concurrency", 20);
const DUPLICATES = arg("duplicates", 50);
const WORKFLOWS = arg("workflows", 25);
if (!INTEGRATION || !SECRET) throw new Error("BENCH_INTEGRATION_ID and BENCH_SECRET are required");

const runId = randomBytes(4).toString("hex");

function signedRequest(body: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  return {
    "content-type": "application/json",
    "x-loopmend-integration": INTEGRATION,
    "x-loopmend-timestamp": ts,
    "x-loopmend-nonce": nonce,
    "x-loopmend-signature": `v1=${createHmac("sha256", SECRET).update(`${ts}.${nonce}.${body}`).digest("hex")}`,
  };
}

function event(i: number) {
  // Spread across workflows and error codes so we exercise both new incidents and recurrences.
  const wf = i % WORKFLOWS;
  const code = ["RATE_LIMITED", "HTTP_503", "ETIMEDOUT", "AUTH_EXPIRED"][i % 4];
  return {
    event: "workflow.execution.failed",
    eventId: `bench_${runId}_${i}`,
    source: "n8n",
    workflow: { id: `bench_wf_${runId}_${wf}`, name: `Benchmark workflow ${wf}` },
    execution: { id: `bench_exec_${runId}_${i}`, status: "error", durationMs: 1200, error: { code, message: `${code} benchmark failure`, node: "HTTP Request" } },
    occurredAt: new Date().toISOString(),
  };
}

type Sample = { ms: number; status: number; outcome?: string; incidentId?: string | null; delayMs: number };

async function send(body: string, occurredAt: number): Promise<Sample> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/v1/webhooks/n8n/incident`, { method: "POST", headers: signedRequest(body), body });
  const json = (await res.json().catch(() => ({}))) as { data?: { outcome?: string; incidentId?: string | null } };
  return { ms: performance.now() - t0, status: res.status, outcome: json.data?.outcome, incidentId: json.data?.incidentId, delayMs: Date.now() - occurredAt };
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const round = (n: number) => Math.round(n * 10) / 10;

async function pool<T>(n: number, concurrency: number, task: (i: number) => Promise<T>) {
  const results: T[] = new Array(n);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < n) {
        const i = next++;
        results[i] = await task(i);
      }
    }),
  );
  return results;
}

async function main() {
  const health = await (await fetch(`${BASE}/api/v1/health`)).json();
  console.log(`target ${BASE} · db ${health.data?.checks?.database?.kind} · ${EVENTS} events @ concurrency ${CONCURRENCY}`);

  // Warm-up (JIT, connection pool), excluded from results.
  await pool(Math.min(50, EVENTS), Math.min(5, CONCURRENCY), async (i) => {
    const e = { ...event(i), eventId: `warm_${runId}_${i}` };
    return send(JSON.stringify(e), Date.now());
  });

  const t0 = performance.now();
  const samples = await pool(EVENTS, CONCURRENCY, async (i) => {
    const e = event(i);
    return send(JSON.stringify(e), Date.parse(e.occurredAt));
  });
  const elapsed = (performance.now() - t0) / 1000;
  const ok = samples.filter((s) => s.status === 202 || s.status === 200);
  const lat = ok.map((s) => s.ms).sort((a, b) => a - b);
  const delay = ok.map((s) => s.delayMs).sort((a, b) => a - b);
  const outcomes = ok.reduce<Record<string, number>>((m, s) => ((m[s.outcome ?? "?"] = (m[s.outcome ?? "?"] ?? 0) + 1), m), {});

  // Duplicate storm: the same event delivered DUPLICATES times concurrently (fresh nonce each).
  const dupEvent = { ...event(0), eventId: `dup_${runId}`, workflow: { id: `bench_dup_${runId}`, name: "Duplicate storm" } };
  const dupBody = JSON.stringify(dupEvent);
  const dups = await Promise.all(Array.from({ length: DUPLICATES }, () => send(dupBody, Date.now())));
  const created = dups.filter((d) => d.outcome === "incident_created").length;
  const incidentIds = new Set(dups.map((d) => d.incidentId).filter(Boolean));

  const result = {
    measuredAt: new Date().toISOString(),
    target: BASE,
    database: health.data?.checks?.database?.kind,
    machine: { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, memoryGb: Math.round(os.totalmem() / 1e9), node: process.version },
    ingestion: {
      events: EVENTS,
      concurrency: CONCURRENCY,
      succeeded: ok.length,
      errors: samples.length - ok.length,
      errorStatuses: samples.filter((s) => !(s.status === 202 || s.status === 200)).reduce<Record<number, number>>((m, s) => ((m[s.status] = (m[s.status] ?? 0) + 1), m), {}),
      throughputPerSec: round(ok.length / elapsed),
      latencyMs: { p50: round(pct(lat, 50)), p95: round(pct(lat, 95)), p99: round(pct(lat, 99)), max: round(lat.at(-1) ?? 0) },
      ingestionDelayMs: { p50: round(pct(delay, 50)), p95: round(pct(delay, 95)) },
      outcomes,
    },
    duplicateStorm: { deliveries: DUPLICATES, incidentsCreated: created, distinctIncidentIds: incidentIds.size, duplicatesReturned: dups.filter((d) => d.outcome === "duplicate").length, errors: dups.filter((d) => d.status >= 300).length },
  };
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  if (created !== 1 || incidentIds.size !== 1) {
    console.error("✗ duplicate storm produced more than one incident");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
