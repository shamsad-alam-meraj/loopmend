import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded");
    return key;
  }
  if (process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY is required in production");
  // Deterministic dev-only key so local data survives restarts. Never used in production.
  return createHash("sha256").update("loopmend-dev-encryption-key").digest();
}

/**
 * Safe description of the configured key for diagnostics: a short SHA-256
 * fingerprint identifies which key is in use without revealing it.
 */
export function encryptionKeyStatus(): { ok: true; fingerprint: string; source: "env" | "dev-default" } | { ok: false; reason: "missing" | "invalid" } {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") return { ok: false, reason: "missing" };
    return { ok: true, fingerprint: createHash("sha256").update(encryptionKey()).digest("hex").slice(0, 8), source: "dev-default" };
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) return { ok: false, reason: "invalid" };
  return { ok: true, fingerprint: createHash("sha256").update(key).digest("hex").slice(0, 8), source: "env" };
}

/** AES-256-GCM authenticated encryption. Format: v1:<iv>:<tag>:<ciphertext> (base64url). */
export function encryptSecret(plaintext: string, aad = "loopmend"): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptSecret(payload: string, aad = "loopmend"): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unsupported ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown, aad?: string): string {
  return encryptSecret(JSON.stringify(value), aad);
}
export function decryptJson<T>(payload: string, aad?: string): T {
  return JSON.parse(decryptSecret(payload, aad)) as T;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret: string, input: string): string {
  return createHmac("sha256", secret).update(input).digest("hex");
}

/** Constant-time comparison of two hex/ascii strings. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function secretHint(secret: string): string {
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}
