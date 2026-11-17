import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { integrations, workflows } from "@schema";
import { getDb } from "@/lib/db/client";
import { HEADER, signPayload } from "@/lib/n8n/signing";
import { AppError } from "@/lib/utils/errors";
import { authorize, type ServiceContext } from "./context";
import { openSecrets } from "./integration.service";
import { recordAudit } from "./audit.service";

export const SCENARIOS = {
  rate_limit: { label: "Rate limited (429)", error: { message: "HTTP 429: Too Many Requests", httpCode: "429", name: "NodeApiError" }, node: "HTTP Request" },
  auth_expired: { label: "Expired credential (401)", error: { message: "HTTP 401: Unauthorized - access token expired", httpCode: "401", name: "NodeApiError" }, node: "CRM Upsert" },
  timeout: { label: "Timeout", error: { message: "ETIMEDOUT: request timed out after 30000ms", name: "NodeOperationError" }, node: "HTTP Request" },
  upstream_503: { label: "Upstream outage (503)", error: { message: "HTTP 503: Service Unavailable", httpCode: "503", name: "NodeApiError" }, node: "HTTP Request" },
  validation: { label: "Invalid input data", error: { message: "Field 'email' is required but was empty", name: "NodeOperationError" }, node: "Validate Input" },
} as const;
export type Scenario = keyof typeof SCENARIOS;

/** Builds a payload shaped like n8n's Error Trigger output (not the canonical contract) to exercise the adapter. */
export function buildErrorTriggerPayload(workflow: { externalId: string; name: string }, scenario: Scenario, executionId: string) {
  const s = SCENARIOS[scenario];
  return {
    execution: {
      id: executionId,
      url: `https://n8n.example.test/workflow/${workflow.externalId}/executions/${executionId}`,
      retryOf: null,
      error: { ...s.error, node: { name: s.node, type: "n8n-nodes-base.httpRequest" } },
      lastNodeExecuted: s.node,
      mode: "trigger",
    },
    workflow: { id: workflow.externalId, name: workflow.name },
  };
}

/**
 * Sends a signed simulated failure through the real public webhook endpoint
 * (signature → replay check → adapter → idempotent ingestion). With
 * `deliverTwice`, the identical body is re-sent with a fresh nonce to
 * demonstrate that retried deliveries do not create duplicate incidents.
 */
export async function simulateFailure(ctx: ServiceContext, input: { workflowId: string; scenario: Scenario; baseUrl: string; deliverTwice?: boolean }) {
  authorize(ctx, "demo:simulate");
  const db = await getDb();
  const [wf] = await db.select().from(workflows).where(and(eq(workflows.id, input.workflowId), eq(workflows.organizationId, ctx.organizationId)));
  if (!wf) throw new AppError("NOT_FOUND", "Workflow not found");
  const [integration] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.organizationId, ctx.organizationId), eq(integrations.type, "n8n")))
    .limit(1);
  if (!integration) throw new AppError("BAD_REQUEST", "Connect an n8n integration first (Settings → Integrations)");
  const { webhookSecret } = openSecrets(ctx.organizationId, integration.encryptedConfig);

  const body = JSON.stringify(buildErrorTriggerPayload(wf, input.scenario, `sim_${randomBytes(6).toString("hex")}`));
  const send = async () => {
    const res = await fetch(new URL("/api/v1/webhooks/n8n/incident", input.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", [HEADER.integration]: integration.id, ...signPayload(webhookSecret, body) },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, body: (await res.json()) as { success: boolean; data: Record<string, unknown> | null; error: { message: string } | null } };
  };

  const first = await send();
  const second = input.deliverTwice ? await send() : null;
  await db.transaction(async (tx) =>
    recordAudit(tx, ctx, { action: "demo.failure_simulated", targetType: "workflow", targetId: wf.id, metadata: { scenario: input.scenario, status: first.status, redelivered: Boolean(second) } }),
  );
  return { first, second };
}
