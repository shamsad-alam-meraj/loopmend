import { route, ok } from "@/lib/http/api";
import { verifyN8nRequest } from "@/lib/n8n/verify-request";
import { normalizeN8nPayload } from "@/lib/n8n/adapter";
import { HEADER } from "@/lib/n8n/signing";
import { sha256Hex } from "@/lib/security/crypto";
import { AppError } from "@/lib/utils/errors";
import { systemContext } from "@/services/context";
import { ingestEvent } from "@/services/ingestion.service";
import { markIntegrationSeen } from "@/services/integration.service";
import { getDb } from "@/lib/db/client";
import { clientKey } from "@/lib/http/api";

/** Sustained events/second per integration (burst = 4×). Tune with WEBHOOK_RATE_LIMIT_PER_SEC. */
const PER_SEC = Math.max(1, Number(process.env.WEBHOOK_RATE_LIMIT_PER_SEC ?? 50) || 50);

export const dynamic = "force-dynamic";

/** POST /api/v1/webhooks/n8n/incident — signed, replay-protected, idempotent event ingestion. */
export const POST = route(
  async (req, { requestId }) => {
    const { body, integration } = await verifyN8nRequest(req);
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      throw new AppError("BAD_REQUEST", "Body is not valid JSON");
    }
    const event = normalizeN8nPayload(raw, { eventIdHeader: req.headers.get(HEADER.idempotency) });
    const ctx = systemContext(integration.organizationId, requestId, "n8n");
    const result = await ingestEvent(ctx, event, { integrationId: integration.id, payloadHash: sha256Hex(body) });
    await markIntegrationSeen(await getDb(), integration.id);
    return ok(
      {
        incidentId: result.incidentId,
        incidentNumber: result.incidentNumber,
        status: result.status,
        outcome: result.outcome,
        duplicate: result.duplicate,
        eventId: event.eventId,
      },
      requestId,
      { status: result.duplicate ? 200 : 202 },
    );
  },
  {
    name: "webhook:n8n",
    rateLimit: { capacity: PER_SEC * 4, refillPerSecond: PER_SEC },
    // One n8n instance sends from one IP; budget per integration so tenants don't share a bucket.
    rateLimitKey: (req) => req.headers.get(HEADER.integration)?.slice(0, 64) || clientKey(req),
  },
);
