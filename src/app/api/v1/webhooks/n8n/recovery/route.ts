import { ok, parseJson, route } from "@/lib/http/api";
import { verifyN8nRequest } from "@/lib/n8n/verify-request";
import { recoveryCallbackBody } from "@/lib/validation/recovery.schema";
import { recordRecoveryCallback } from "@/services/recovery.service";

export const dynamic = "force-dynamic";

/** POST /api/v1/webhooks/n8n/recovery — signed async result from the n8n recovery-executor workflow. */
export const POST = route(
  async (req, { requestId }) => {
    const { body, integration } = await verifyN8nRequest(req);
    const payload = parseJson(body, recoveryCallbackBody);
    return ok(await recordRecoveryCallback(integration.organizationId, payload), requestId);
  },
  { name: "webhook:recovery", rateLimit: { capacity: 60, refillPerSecond: 10 } },
);
