import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { integrations } from "@schema";
import { getDb, type Executor } from "@/lib/db/client";
import { decryptJson, encryptJson, secretHint } from "@/lib/security/crypto";
import { AppError } from "@/lib/utils/errors";
import { authorize, type ServiceContext } from "./context";
import { recordAudit } from "./audit.service";

export type IntegrationSecrets = { webhookSecret: string; apiKey?: string };

/** Ciphertext is bound to the integration's organization via AAD. */
const aad = (orgId: string) => `integration:${orgId}`;

export function sealSecrets(orgId: string, secrets: IntegrationSecrets) {
  return encryptJson(secrets, aad(orgId));
}

export function openSecrets(orgId: string, sealed: string): IntegrationSecrets {
  return decryptJson<IntegrationSecrets>(sealed, aad(orgId));
}

export async function listIntegrations(ctx: ServiceContext) {
  authorize(ctx, "dashboard:read");
  const db = await getDb();
  return db
    .select({
      id: integrations.id,
      name: integrations.name,
      type: integrations.type,
      baseUrl: integrations.baseUrl,
      status: integrations.status,
      secretHint: integrations.secretHint,
      lastVerifiedAt: integrations.lastVerifiedAt,
      createdAt: integrations.createdAt,
    })
    .from(integrations)
    .where(eq(integrations.organizationId, ctx.organizationId))
    .orderBy(desc(integrations.createdAt));
}

function validateBaseUrl(baseUrl?: string | null) {
  if (!baseUrl) return null;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AppError("VALIDATION_FAILED", "Base URL must be a valid URL");
  }
  if (!["https:", "http:"].includes(url.protocol)) throw new AppError("VALIDATION_FAILED", "Base URL must be http(s)");
  if (url.protocol === "http:" && process.env.NODE_ENV === "production" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new AppError("VALIDATION_FAILED", "Use https for remote n8n instances");
  }
  return url.origin;
}

/** Creates an n8n integration. Returns the webhook secret ONCE; only ciphertext is stored. */
export async function createIntegration(ctx: ServiceContext, input: { name: string; baseUrl?: string | null; apiKey?: string | null }) {
  authorize(ctx, "integration:manage");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) throw new AppError("VALIDATION_FAILED", "Name must be 2–60 characters");
  const baseUrl = validateBaseUrl(input.baseUrl);
  const webhookSecret = randomBytes(32).toString("hex");
  const secrets: IntegrationSecrets = { webhookSecret, ...(input.apiKey ? { apiKey: input.apiKey.trim() } : {}) };
  const db = await getDb();
  const row = await db.transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.organizationId, ctx.organizationId), eq(integrations.name, name)));
    if (dup) throw new AppError("CONFLICT", "An integration with this name already exists");
    const [created] = await tx
      .insert(integrations)
      .values({
        organizationId: ctx.organizationId,
        type: "n8n",
        name,
        baseUrl,
        encryptedConfig: sealSecrets(ctx.organizationId, secrets),
        secretHint: input.apiKey ? secretHint(input.apiKey) : null,
        status: "pending",
      })
      .returning();
    await recordAudit(tx, ctx, { action: "integration.created", targetType: "integration", targetId: created.id, metadata: { name, baseUrl, hasApiKey: Boolean(input.apiKey) } });
    return created;
  });
  return { integration: row, webhookSecret };
}

export async function rotateWebhookSecret(ctx: ServiceContext, integrationId: string) {
  authorize(ctx, "integration:manage");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(integrations)
      .where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, ctx.organizationId)));
    if (!row) throw new AppError("NOT_FOUND", "Integration not found");
    const current = openSecrets(ctx.organizationId, row.encryptedConfig);
    const webhookSecret = randomBytes(32).toString("hex");
    await tx
      .update(integrations)
      .set({ encryptedConfig: sealSecrets(ctx.organizationId, { ...current, webhookSecret }), updatedAt: new Date() })
      .where(eq(integrations.id, row.id));
    await recordAudit(tx, ctx, { action: "integration.secret_rotated", targetType: "integration", targetId: row.id });
    return { webhookSecret };
  });
}

export async function deleteIntegration(ctx: ServiceContext, integrationId: string) {
  authorize(ctx, "integration:manage");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(integrations)
      .where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, ctx.organizationId)))
      .returning({ id: integrations.id, name: integrations.name });
    if (!row) throw new AppError("NOT_FOUND", "Integration not found");
    await recordAudit(tx, ctx, { action: "integration.deleted", targetType: "integration", targetId: row.id, metadata: { name: row.name } });
  });
}

/** Machine path: resolve integration + decrypted secrets from the signed request's integration id. */
export async function loadIntegrationForWebhook(integrationId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(integrationId)) return null;
  const db = await getDb();
  const [row] = await db.select().from(integrations).where(eq(integrations.id, integrationId));
  if (!row || row.status === "disabled") return null;
  return { integration: row, secrets: openSecrets(row.organizationId, row.encryptedConfig) };
}

export async function markIntegrationSeen(ex: Executor, integrationId: string) {
  await ex.update(integrations).set({ status: "connected", lastVerifiedAt: new Date() }).where(eq(integrations.id, integrationId));
}

/** Calls the n8n public API to verify connectivity when an API key is stored. */
export async function testIntegration(ctx: ServiceContext, integrationId: string) {
  authorize(ctx, "integration:manage");
  const db = await getDb();
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, ctx.organizationId)));
  if (!row) throw new AppError("NOT_FOUND", "Integration not found");
  const { apiKey } = openSecrets(ctx.organizationId, row.encryptedConfig);
  if (!row.baseUrl || !apiKey) return { ok: false, message: "Add a base URL and API key to test the n8n API. Webhook ingestion works without them." };
  try {
    const res = await fetch(`${row.baseUrl}/api/v1/workflows?limit=1`, { headers: { "X-N8N-API-KEY": apiKey }, signal: AbortSignal.timeout(5000) });
    const ok = res.ok;
    await db.update(integrations).set({ status: ok ? "connected" : "error", lastVerifiedAt: new Date() }).where(eq(integrations.id, row.id));
    return { ok, message: ok ? "Connected to n8n API" : `n8n API responded with HTTP ${res.status}` };
  } catch (e) {
    await db.update(integrations).set({ status: "error" }).where(eq(integrations.id, row.id));
    return { ok: false, message: `Could not reach n8n: ${(e as Error).message}` };
  }
}
