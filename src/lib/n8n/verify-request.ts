import "server-only";
import type { NextRequest } from "next/server";
import { HEADER, verifySignature } from "./signing";
import { loadIntegrationForWebhook } from "@/services/integration.service";
import { consumeNonce } from "@/services/replay.service";
import { AppError } from "@/lib/utils/errors";
import { readBodyText } from "@/lib/http/api";
import { logger } from "@/lib/utils/logger";

/**
 * Authenticates a machine-to-machine request from n8n:
 *  1. size-capped raw body
 *  2. integration lookup → per-integration secret (decrypted server-side)
 *  3. HMAC over timestamp.nonce.body (constant-time compare)
 *  4. timestamp window (rejects stale / far-future requests)
 *  5. single-use nonce (rejects replays)
 */
export async function verifyN8nRequest(req: NextRequest) {
  const body = await readBodyText(req);
  const integrationId = req.headers.get(HEADER.integration) ?? "";
  const loaded = await loadIntegrationForWebhook(integrationId);
  if (!loaded) throw new AppError("INVALID_SIGNATURE", "Unknown or disabled integration");

  const check = verifySignature(loaded.secrets.webhookSecret, body, {
    signature: req.headers.get(HEADER.signature),
    timestamp: req.headers.get(HEADER.timestamp),
    nonce: req.headers.get(HEADER.nonce),
  });
  if (!check.ok) {
    logger.warn("webhook signature rejected", { integrationId, reason: check.reason });
    throw new AppError("INVALID_SIGNATURE", `Signature verification failed (${check.reason})`);
  }
  // Only consume the nonce after the signature is valid, so attackers cannot burn nonces.
  if (!(await consumeNonce(`${integrationId}:${check.nonce}`))) {
    throw new AppError("REPLAY_DETECTED", "This request was already received (nonce reuse)");
  }
  return { body, integration: loaded.integration, secrets: loaded.secrets };
}
