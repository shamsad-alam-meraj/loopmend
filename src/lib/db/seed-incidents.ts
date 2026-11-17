import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import * as schema from "@schema";
import type { Db } from "./client";
import { registerSeedHook } from "./seed";
import { sealSecrets } from "@/services/integration.service";
import { ingestEvent } from "@/services/ingestion.service";
import { systemContext } from "@/services/context";
import { sha256Hex } from "@/lib/security/crypto";
import type { CanonicalEvent } from "@/lib/validation/webhook.schema";

export const DEMO_INTEGRATION_NAME = "Demo n8n";

/** Demo integration secret: N8N_WEBHOOK_SECRET so a local docker n8n can sign requests. */
function demoWebhookSecret() {
  return process.env.N8N_WEBHOOK_SECRET || "dev-only-webhook-secret-change-me-0123456789";
}

registerSeedHook(async (db: Db, { orgIds }) => {
  for (const orgId of Object.values(orgIds)) {
    const [integration] = await db
      .insert(schema.integrations)
      .values({
        organizationId: orgId,
        type: "n8n",
        name: DEMO_INTEGRATION_NAME,
        baseUrl: process.env.N8N_BASE_URL || null,
        encryptedConfig: sealSecrets(orgId, { webhookSecret: demoWebhookSecret() }),
        status: "connected",
        lastVerifiedAt: new Date(),
      })
      .returning();
    await db.update(schema.workflows).set({ integrationId: integration.id }).where(eq(schema.workflows.organizationId, orgId));
  }

  // Replay the last 72h of demo failures through the real ingestion pipeline.
  const since = new Date(Date.now() - 72 * 3_600_000);
  for (const orgId of Object.values(orgIds)) {
    const failures = await db
      .select({ e: schema.executions, w: schema.workflows })
      .from(schema.executions)
      .innerJoin(schema.workflows, eq(schema.executions.workflowId, schema.workflows.id))
      .where(and(eq(schema.executions.organizationId, orgId), eq(schema.executions.status, "error"), gte(schema.executions.startedAt, since)))
      .orderBy(asc(schema.executions.startedAt));
    const ctx = systemContext(orgId, "seed", "n8n");
    for (const { e, w } of failures) {
      const event: CanonicalEvent = {
        event: "workflow.execution.failed",
        eventId: `seed_${e.externalId}`,
        source: "n8n",
        workflow: { id: w.externalId, name: w.name },
        execution: {
          id: e.externalId,
          status: "error",
          durationMs: e.durationMs,
          mode: e.mode ?? undefined,
          startedAt: e.startedAt.toISOString(),
          error: { code: e.errorCode ?? undefined, message: e.errorMessage ?? "failed", node: e.errorNode ?? undefined, httpStatus: e.httpStatus ?? undefined },
        },
        occurredAt: (e.finishedAt ?? e.startedAt).toISOString(),
      };
      await ingestEvent(ctx, event, { payloadHash: sha256Hex(JSON.stringify(event)) });
    }
  }
});
