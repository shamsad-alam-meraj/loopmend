/**
 * End-to-end check of every Loopmend API endpoint against a running deployment.
 *
 *   CHECK_URL=https://… CHECK_SESSION=<operator lm_session cookie> \
 *   CHECK_INTEGRATION_ID=… CHECK_WEBHOOK_SECRET=… CHECK_CRON_SECRET=… \
 *   npx tsx infrastructure/scripts/api-check.ts
 *
 * Creates clearly-labeled "api-check" events in the session's organization.
 * Exits non-zero if any endpoint returns an unexpected status.
 */
import { createHmac, randomBytes } from "node:crypto";

const BASE = (process.env.CHECK_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const SESSION = process.env.CHECK_SESSION ?? "";
const INTEGRATION = process.env.CHECK_INTEGRATION_ID ?? "";
const WEBHOOK_SECRET = process.env.CHECK_WEBHOOK_SECRET ?? "";
const CRON = process.env.CHECK_CRON_SECRET ?? "";
const run = randomBytes(3).toString("hex");

type Row = { name: string; expected: number[]; status: number; ms: number; note?: string };
const rows: Row[] = [];

async function call(name: string, expected: number | number[], path: string, init: RequestInit & { auth?: boolean; raw?: boolean } = {}) {
  const exp = Array.isArray(expected) ? expected : [expected];
  const headers = new Headers(init.headers);
  if (init.auth !== false && SESSION) headers.set("cookie", `lm_session=${SESSION}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/v1${path}`, { ...init, headers, redirect: "manual" });
  const ms = Math.round(performance.now() - t0);
  const text = init.raw ? "" : await res.text();
  let json: { data?: unknown; error?: { code?: string; message?: string } } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON (markdown, SSE) */
  }
  if (init.raw) await res.body?.cancel();
  rows.push({ name, expected: exp, status: res.status, ms, note: exp.includes(res.status) ? undefined : (json.error?.code ? `${json.error.code}: ${json.error.message}` : text.slice(0, 120)) });
  return { status: res.status, data: json.data as Record<string, unknown> & Record<string, never>, res };
}

function signed(body: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  return {
    "content-type": "application/json",
    "x-loopmend-integration": INTEGRATION,
    "x-loopmend-timestamp": ts,
    "x-loopmend-nonce": nonce,
    "x-loopmend-signature": `v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${ts}.${nonce}.${body}`).digest("hex")}`,
  };
}

const failure = (workflow: string, name: string, code: string, message: string, n: number) =>
  JSON.stringify({
    event: "workflow.execution.failed",
    eventId: `apicheck_${run}_${n}`,
    source: "n8n",
    workflow: { id: workflow, name },
    execution: { id: `apicheck_${run}_exec_${n}`, status: "error", durationMs: 1500, error: { code, message, node: "HTTP Request" } },
    occurredAt: new Date().toISOString(),
  });

async function main() {
  console.log(`Checking ${BASE} (run ${run})`);
  await call("GET /health", 200, "/health", { auth: false });
  await call("GET /openapi.json", 200, "/openapi.json", { auth: false });

  // --- ingestion
  const body1 = failure("wf_customer_onboarding", "Customer Onboarding", "UPSTREAM_503", "HTTP 503: Service Unavailable (api-check)", 1);
  const ing = await call("POST /webhooks/n8n/incident (signed)", [202, 200], "/webhooks/n8n/incident", { method: "POST", body: body1, headers: signed(body1), auth: false });
  await call("POST /webhooks/n8n/incident (re-delivery → duplicate)", 200, "/webhooks/n8n/incident", { method: "POST", body: body1, headers: signed(body1), auth: false });
  await call("POST /webhooks/n8n/incident (unsigned → 401)", 401, "/webhooks/n8n/incident", { method: "POST", body: body1, auth: false });
  const incidentId = ing.data?.incidentId as string;

  // --- incidents
  await call("GET /incidents", 200, "/incidents?view=all&limit=5");
  await call("GET /incidents (no session → 401)", 401, "/incidents", { auth: false });
  await call("GET /incidents/:id", 200, `/incidents/${incidentId}`);
  await call("PATCH /incidents/:id (note)", 200, `/incidents/${incidentId}`, { method: "PATCH", body: JSON.stringify({ note: "api-check note" }) });

  // --- investigation → auto-proposed plan
  await call("POST /incidents/:id/investigate", 201, `/incidents/${incidentId}/investigate`, { method: "POST" });
  await call("GET /investigations", 200, `/investigations?incidentId=${incidentId}`);
  const plans = await call("GET /recovery-plans", 200, `/recovery-plans?incidentId=${incidentId}`);
  const planId = ((plans.data as unknown as { plan: { id: string; status: string } }[]) ?? [])[0]?.plan.id;
  await call("GET /recovery-plans/:id", 200, `/recovery-plans/${planId}`);
  await call("POST /recovery-plans/:id/approve", 200, `/recovery-plans/${planId}/approve`, { method: "POST", body: JSON.stringify({ comment: "api-check" }) });
  await call("POST /recovery-plans/:id/execute", [202, 200], `/recovery-plans/${planId}/execute`, { method: "POST" });
  await call("POST /recovery-plans/:id/execute (again → no duplicate)", 200, `/recovery-plans/${planId}/execute`, { method: "POST" });
  await call("GET /incidents/:id/postmortem", 200, `/incidents/${incidentId}/postmortem`);

  // --- create + reject on a second incident
  const body2 = failure("wf_payment_notification", "Payment Notification", "ETIMEDOUT", "ETIMEDOUT after 30000ms (api-check)", 2);
  const ing2 = await call("POST /webhooks/n8n/incident (second)", [202, 200], "/webhooks/n8n/incident", { method: "POST", body: body2, headers: signed(body2), auth: false });
  const created = await call("POST /recovery-plans", [201, 200], "/recovery-plans", { method: "POST", body: JSON.stringify({ incidentId: ing2.data?.incidentId, strategy: "retry_execution" }), headers: { "idempotency-key": `apicheck-${run}` } });
  const plan2 = (created.data?.plan as { id: string } | undefined)?.id;
  await call("POST /recovery-plans/:id/reject", 200, `/recovery-plans/${plan2}/reject`, { method: "POST", body: JSON.stringify({ comment: "api-check" }) });

  // --- workflows, analytics, audit, realtime
  const wfs = await call("GET /workflows", 200, "/workflows");
  const wfId = ((wfs.data as unknown as { id: string }[]) ?? [])[0]?.id;
  await call("GET /workflows/:id", 200, `/workflows/${wfId}`);
  await call("GET /workflows/:id/executions", 200, `/workflows/${wfId}/executions?limit=5`);
  await call("PATCH /workflows/:id (operator → 403)", 403, `/workflows/${wfId}`, { method: "PATCH", body: JSON.stringify({ criticality: "high" }) });
  await call("GET /analytics/reliability", 200, "/analytics/reliability?days=7");
  await call("GET /audit", 200, "/audit?limit=5");
  await call("GET /events/stream (SSE)", 200, "/events/stream", { raw: true, signal: AbortSignal.timeout(15000) });

  // --- machine endpoints
  const cb = JSON.stringify({ attemptId: "00000000-0000-0000-0000-000000000000", idempotencyKey: "plan:none:attempt:1", status: "succeeded" });
  await call("POST /webhooks/n8n/recovery (unknown attempt → 404)", 404, "/webhooks/n8n/recovery", { method: "POST", body: cb, headers: signed(cb), auth: false });
  await call("GET /cron/recoveries", CRON ? 200 : 401, "/cron/recoveries", { auth: false, headers: CRON ? { authorization: `Bearer ${CRON}` } : {} });
  await call("GET /cron/reliability-report", CRON ? 200 : 401, "/cron/reliability-report", { auth: false, headers: CRON ? { authorization: `Bearer ${CRON}` } : {} });
  await call("GET /cron/recoveries (no secret → 401)", 401, "/cron/recoveries", { auth: false });

  const width = Math.max(...rows.map((r) => r.name.length));
  let failed = 0;
  for (const r of rows) {
    const ok = r.expected.includes(r.status);
    if (!ok) failed++;
    console.log(`${ok ? "✓" : "✗"} ${r.name.padEnd(width)}  ${r.status}  ${String(r.ms).padStart(5)} ms${r.note ? `  ← ${r.note}` : ""}`);
  }
  console.log(`\n${rows.length - failed}/${rows.length} endpoints behaved as expected`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
