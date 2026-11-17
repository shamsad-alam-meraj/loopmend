import { createHash } from "node:crypto";
import { canonicalEventSchema, type CanonicalEvent } from "@/lib/validation/webhook.schema";
import { extractHttpStatus } from "@/lib/incidents/classifier";
import { AppError } from "@/lib/utils/errors";

/**
 * Transforms whatever n8n actually sent into the canonical contract.
 * Supports:
 *  1. Canonical payloads (our incident-ingestion workflow normalizes first)
 *  2. Raw n8n Error Trigger output: { execution: { id, error, lastNodeExecuted, mode, retryOf }, workflow: { id, name } }
 *  3. Trigger-level failures (no execution yet): { trigger: { error, mode }, workflow }
 * Different n8n versions differ slightly (error.httpCode vs error.context.httpCode,
 * error.node.name vs lastNodeExecuted), so every field is read defensively.
 */
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : undefined);

const SECRET_PATTERNS: [RegExp, string][] = [
  [/(bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, "$1[redacted]"],
  [/((?:api[_-]?key|token|secret|password|authorization)["'\s:=]+)[^\s"',}]+/gi, "$1[redacted]"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  [/\b(?:\d[ -]*?){13,19}\b/g, "[number]"],
];

/** Strip credentials/PII from error text before it is stored or sent to an AI provider. */
export function sanitizeText(input: string, max = 2000): string {
  let out = input;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out.slice(0, max);
}

function deriveEventId(workflowId: string, executionId: string, kind: string) {
  return `n8n_${createHash("sha256").update(`${workflowId}:${executionId}:${kind}`).digest("hex").slice(0, 32)}`;
}

export function normalizeN8nPayload(raw: unknown, opts: { now?: Date; eventIdHeader?: string | null } = {}): CanonicalEvent {
  const body = obj(raw);
  if (body.event && body.source === "n8n") {
    const parsed = canonicalEventSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", "Canonical event failed validation", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    return { ...parsed.data, execution: { ...parsed.data.execution, error: parsed.data.execution.error && { ...parsed.data.execution.error, message: sanitizeText(parsed.data.execution.error.message) } } };
  }

  const workflow = obj(body.workflow);
  const execution = obj(body.execution);
  const trigger = obj(body.trigger);
  const workflowId = str(workflow.id);
  const workflowName = str(workflow.name) ?? "Unnamed workflow";
  if (!workflowId) throw new AppError("VALIDATION_FAILED", "n8n payload is missing workflow.id");

  const isTriggerFailure = !str(execution.id) && Object.keys(trigger).length > 0;
  const err = obj(isTriggerFailure ? trigger.error : execution.error);
  const errNode = obj(err.node);
  const ctx = obj(err.context);
  const message = sanitizeText(str(err.message) ?? str(err.description) ?? "Workflow execution failed");
  const httpStatus = Number(str(err.httpCode) ?? str(ctx.httpCode) ?? extractHttpStatus(message) ?? NaN);
  const executionId = str(execution.id) ?? `trigger_${createHash("sha256").update(`${workflowId}:${message}:${str(trigger.timestamp) ?? ""}`).digest("hex").slice(0, 16)}`;
  const code = str(err.code) ?? (Number.isFinite(httpStatus) ? (httpStatus === 429 ? "RATE_LIMITED" : `HTTP_${httpStatus}`) : undefined);

  const candidate = {
    event: "workflow.execution.failed" as const,
    eventId: opts.eventIdHeader ?? deriveEventId(workflowId, executionId, "failed"),
    source: "n8n" as const,
    workflow: { id: workflowId, name: workflowName },
    execution: {
      id: executionId,
      status: "error" as const,
      durationMs: null,
      mode: str(execution.mode) ?? str(trigger.mode),
      retryOf: str(execution.retryOf) ?? null,
      error: {
        code: code && /^[A-Za-z0-9_]{1,64}$/.test(code) ? code.toUpperCase() : undefined,
        message,
        node: str(execution.lastNodeExecuted) ?? str(errNode.name),
        httpStatus: Number.isFinite(httpStatus) ? httpStatus : undefined,
      },
    },
    occurredAt: (opts.now ?? new Date()).toISOString(),
  };
  const parsed = canonicalEventSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "Could not normalize n8n payload", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return parsed.data;
}
