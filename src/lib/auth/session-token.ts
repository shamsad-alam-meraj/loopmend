import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Local-auth session token: base64url(JSON payload) + "." + HMAC-SHA256.
 * Used only when Supabase Auth is not configured (local dev / demo).
 */
export const SESSION_COOKIE = "lm_session";
export const ORG_COOKIE = "lm_org";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type SessionPayload = { sub: string; iat: number; exp: number; /** profile.session_version at issue time */ ver?: number };

function sign(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(userId: string, secret: string, now = Date.now(), version = 0): string {
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = { sub: userId, iat, exp: iat + SESSION_TTL_SECONDS, ver: version };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

export function verifySessionToken(token: string | undefined | null, secret: string, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}
