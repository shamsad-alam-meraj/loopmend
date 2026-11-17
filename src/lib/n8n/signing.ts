import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Machine-to-machine webhook signing (n8n <-> Loopmend).
 *
 *   signature = HMAC_SHA256(secret, `${timestamp}.${nonce}.${rawBody}`)
 *   headers:  x-loopmend-signature: v1=<hex>
 *             x-loopmend-timestamp: <unix seconds>
 *             x-loopmend-nonce:     <16+ random chars, single use>
 *             x-loopmend-integration: <integration id>  (selects the secret)
 */
export const HEADER = {
  signature: "x-loopmend-signature",
  timestamp: "x-loopmend-timestamp",
  nonce: "x-loopmend-nonce",
  integration: "x-loopmend-integration",
  idempotency: "idempotency-key",
} as const;

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function computeSignature(secret: string, timestamp: string, nonce: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
}

export function signPayload(secret: string, body: string, opts: { now?: number; nonce?: string } = {}) {
  const timestamp = String(Math.floor((opts.now ?? Date.now()) / 1000));
  const nonce = opts.nonce ?? randomBytes(16).toString("hex");
  return {
    [HEADER.signature]: `v1=${computeSignature(secret, timestamp, nonce, body)}`,
    [HEADER.timestamp]: timestamp,
    [HEADER.nonce]: nonce,
  };
}

export type SignatureCheck =
  | { ok: true; timestamp: number; nonce: string }
  | { ok: false; reason: "missing_headers" | "malformed" | "stale" | "future" | "bad_signature" };

export function verifySignature(
  secret: string,
  body: string,
  headers: { signature?: string | null; timestamp?: string | null; nonce?: string | null },
  now = Date.now(),
): SignatureCheck {
  const { signature, timestamp, nonce } = headers;
  if (!signature || !timestamp || !nonce) return { ok: false, reason: "missing_headers" };
  if (!/^\d{9,11}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return { ok: false, reason: "malformed" };
  const ts = Number(timestamp);
  const skew = Math.floor(now / 1000) - ts;
  if (skew > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  if (skew < -SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "future" };
  const provided = signature.startsWith("v1=") ? signature.slice(3) : signature;
  const expected = computeSignature(secret, timestamp, nonce, body);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };
  return { ok: true, timestamp: ts, nonce };
}
