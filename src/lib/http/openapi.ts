import { z, type ZodType } from "zod";
import { canonicalEventSchema } from "@/lib/validation/webhook.schema";
import { executionListQuery, incidentListQuery, incidentUpdateBody, workflowUpdateBody } from "@/lib/validation/query.schema";
import { createPlanBody, decisionBody, recoveryCallbackBody } from "@/lib/validation/recovery.schema";
import { investigationSchema } from "@/lib/ai/schemas/investigation.schema";

/**
 * OpenAPI 3.1 document generated from the same Zod schemas that validate
 * requests at runtime, so documentation cannot drift from behaviour.
 */
const schema = (s: ZodType, io: "input" | "output" = "input") => z.toJSONSchema(s, { io, unrepresentable: "any" });

type Op = {
  method: "get" | "post" | "patch";
  path: string;
  summary: string;
  tag: string;
  auth: "session" | "signature" | "cron" | "public";
  permission?: string;
  body?: ZodType;
  query?: ZodType;
  pathParams?: string[];
  success?: number;
  idempotencyKey?: boolean;
};

const OPS: Op[] = [
  { method: "post", path: "/webhooks/n8n/incident", summary: "Receive a signed n8n failure/success event (canonical or raw Error Trigger payload). Idempotent per eventId.", tag: "Webhooks", auth: "signature", body: canonicalEventSchema, success: 202 },
  { method: "post", path: "/webhooks/n8n/recovery", summary: "Signed asynchronous recovery result from the n8n recovery executor. Applied once per attempt.", tag: "Webhooks", auth: "signature", body: recoveryCallbackBody },
  { method: "get", path: "/incidents", summary: "List incidents (filters, search, keyset pagination via meta.nextCursor).", tag: "Incidents", auth: "session", permission: "incident:read", query: incidentListQuery },
  { method: "get", path: "/incidents/{id}", summary: "Incident with workflow, latest execution, assignee and timeline.", tag: "Incidents", auth: "session", permission: "incident:read", pathParams: ["id"] },
  { method: "patch", path: "/incidents/{id}", summary: "Acknowledge, assign, resolve, dismiss, reopen, change severity or add a note.", tag: "Incidents", auth: "session", permission: "incident:update", pathParams: ["id"], body: incidentUpdateBody },
  { method: "post", path: "/incidents/{id}/investigate", summary: "Run classification + root-cause investigation (Gemini or rules fallback). Returns the validated AI output contract.", tag: "Investigations", auth: "session", permission: "incident:investigate", pathParams: ["id"], success: 201 },
  { method: "get", path: "/incidents/{id}/postmortem", summary: "Blameless postmortem as text/markdown.", tag: "Incidents", auth: "session", permission: "incident:read", pathParams: ["id"] },
  { method: "get", path: "/investigations", summary: "List investigations (optionally ?incidentId=).", tag: "Investigations", auth: "session", permission: "incident:read" },
  { method: "get", path: "/workflows", summary: "Monitored workflows with health and stats (?windowHours=).", tag: "Workflows", auth: "session", permission: "dashboard:read" },
  { method: "get", path: "/workflows/{id}", summary: "Workflow with 24h and 7d stats.", tag: "Workflows", auth: "session", permission: "dashboard:read", pathParams: ["id"] },
  { method: "patch", path: "/workflows/{id}", summary: "Update criticality, side-effect profile, auto-recovery or status.", tag: "Workflows", auth: "session", permission: "workflow:manage", pathParams: ["id"], body: workflowUpdateBody },
  { method: "get", path: "/workflows/{id}/executions", summary: "Execution history (keyset pagination).", tag: "Workflows", auth: "session", permission: "dashboard:read", pathParams: ["id"], query: executionListQuery },
  { method: "get", path: "/recovery-plans", summary: "List recovery plans (?status=, ?incidentId=).", tag: "Recovery", auth: "session", permission: "incident:read" },
  { method: "post", path: "/recovery-plans", summary: "Create a policy-checked recovery plan. Supports Idempotency-Key.", tag: "Recovery", auth: "session", permission: "recovery:create", body: createPlanBody, success: 201, idempotencyKey: true },
  { method: "get", path: "/recovery-plans/{id}", summary: "Plan with attempts and approvals.", tag: "Recovery", auth: "session", permission: "incident:read", pathParams: ["id"] },
  { method: "post", path: "/recovery-plans/{id}/approve", summary: "Approve a pending plan (admin for high risk; requester cannot self-approve high risk).", tag: "Recovery", auth: "session", permission: "recovery:approve", pathParams: ["id"], body: decisionBody },
  { method: "post", path: "/recovery-plans/{id}/reject", summary: "Reject a pending plan.", tag: "Recovery", auth: "session", permission: "recovery:approve", pathParams: ["id"], body: decisionBody },
  { method: "post", path: "/recovery-plans/{id}/execute", summary: "Run one idempotent attempt of an approved plan.", tag: "Recovery", auth: "session", permission: "recovery:execute", pathParams: ["id"], success: 202 },
  { method: "get", path: "/analytics/reliability", summary: "Success rate, p95, MTTR/MTTA, SLOs + error budgets, recovery success, anomalies (?days=).", tag: "Analytics", auth: "session", permission: "dashboard:read" },
  { method: "get", path: "/audit", summary: "Append-only audit log (?before=, ?targetId=, ?limit=).", tag: "Audit", auth: "session", permission: "audit:read" },
  { method: "get", path: "/events/stream", summary: "Server-Sent Events change feed for the active organization.", tag: "Realtime", auth: "session", permission: "dashboard:read" },
  { method: "get", path: "/cron/recoveries", summary: "Run due backoff retries and enforce deadlines.", tag: "Operations", auth: "cron" },
  { method: "get", path: "/cron/reliability-report", summary: "Per-organization daily reliability summary.", tag: "Operations", auth: "cron" },
  { method: "get", path: "/health", summary: "Liveness and database readiness (503 when the database is down).", tag: "Operations", auth: "public" },
];

const ERRORS = ["400", "401", "403", "404", "409", "413", "422", "429", "500", "503"];

function queryParams(q?: ZodType) {
  if (!q) return [];
  const js = schema(q) as { properties?: Record<string, object>; required?: string[] };
  return Object.entries(js.properties ?? {}).map(([name, s]) => ({ name, in: "query", required: js.required?.includes(name) ?? false, schema: s }));
}

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const security =
      op.auth === "session" ? [{ session: [] }] : op.auth === "signature" ? [{ loopmendSignature: [], loopmendTimestamp: [], loopmendNonce: [], loopmendIntegration: [] }] : op.auth === "cron" ? [{ cronBearer: [] }] : [];
    paths[op.path] ??= {};
    paths[op.path][op.method] = {
      summary: op.summary,
      tags: [op.tag],
      ...(op.permission ? { description: `Requires permission \`${op.permission}\` in the active organization (\`x-organization-id\` header or org cookie).` } : {}),
      security,
      parameters: [
        ...(op.pathParams ?? []).map((name) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } })),
        ...queryParams(op.query),
        ...(op.idempotencyKey ? [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 200 } }] : []),
      ],
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: schema(op.body) } } } } : {}),
      responses: {
        [String(op.success ?? 200)]: { description: "Success", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
        ...Object.fromEntries(ERRORS.map((c) => [c, { $ref: "#/components/responses/Error" }])),
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Loopmend API",
      version: "1.0.0",
      description: "Workflow reliability & self-healing for n8n. All responses use the envelope { success, data, error, meta: { requestId } }.",
    },
    servers: [{ url: `${serverUrl.replace(/\/$/, "")}/api/v1` }],
    tags: ["Webhooks", "Incidents", "Investigations", "Workflows", "Recovery", "Analytics", "Audit", "Realtime", "Operations"].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "lm_session", description: "Local session cookie, or Supabase auth cookies when Supabase Auth is configured." },
        loopmendSignature: { type: "apiKey", in: "header", name: "x-loopmend-signature", description: "v1=HMAC_SHA256(secret, `${timestamp}.${nonce}.${rawBody}`)" },
        loopmendTimestamp: { type: "apiKey", in: "header", name: "x-loopmend-timestamp", description: "Unix seconds, within ±300s" },
        loopmendNonce: { type: "apiKey", in: "header", name: "x-loopmend-nonce", description: "16–128 chars, single use" },
        loopmendIntegration: { type: "apiKey", in: "header", name: "x-loopmend-integration", description: "Integration id (selects the signing secret)" },
        cronBearer: { type: "http", scheme: "bearer", description: "CRON_SECRET" },
      },
      schemas: {
        Envelope: {
          type: "object",
          required: ["success", "data", "error", "meta"],
          properties: {
            success: { type: "boolean" },
            data: {},
            error: { type: ["object", "null"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } },
            meta: { type: "object", properties: { requestId: { type: "string" }, nextCursor: { type: ["string", "null"] } } },
          },
        },
        InvestigationResult: schema(investigationSchema, "output"),
        CanonicalEvent: schema(canonicalEventSchema),
      },
      responses: { Error: { description: "Error envelope (success=false, error.code is stable)", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } } },
    },
  };
}

export const API_OPERATIONS = OPS.map(({ method, path, summary, tag, auth, permission }) => ({ method, path, summary, tag, auth, permission }));
