/**
 * Request-safety helpers shared by route handlers, server actions and the proxy.
 * Pure functions (no Next imports) so they are unit-testable.
 */

/**
 * Returns a same-origin relative path or the fallback. Parses with the URL
 * parser browsers use, so tricks like "/\evil.com", "/%09/evil.com" or
 * "//evil.com" that resolve to another origin are rejected.
 */
export function safeRedirectPath(value: unknown, fallback = "/overview"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 2048) return fallback;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  // Defense in depth: reject backslashes and control characters, raw or percent-encoded.
  if (/[\\\u0000-\u001f\u007f]/.test(value) || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback;
  try {
    const base = "http://loopmend.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Client IP for rate limiting. Prefers headers set by the platform (Vercel /
 * reverse proxy) over client-controllable ones; for X-Forwarded-For uses the
 * right-most hop, which our own proxy (Caddy / Vercel) appended.
 */
export function clientIp(get: (name: string) => string | null): string {
  const platform = get("x-vercel-forwarded-for") ?? get("x-real-ip");
  if (platform) return platform.split(",")[0].trim().slice(0, 64);
  const hops = (get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (hops.at(-1) ?? "local").slice(0, 64);
}

/** Reads a body stream, aborting as soon as it exceeds maxBytes (no full buffering of oversized uploads). */
export async function readLimited(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<{ text: string; tooLarge: boolean }> {
  if (!body) return { text: "", tooLarge: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return { text: "", tooLarge: true };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), tooLarge: false };
}
