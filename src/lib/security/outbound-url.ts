import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for server-side requests to user-supplied URLs (e.g. an n8n base
 * URL entered by an admin). Blocks loopback, private, link-local (incl. cloud
 * metadata), CGNAT, unique-local and unspecified addresses after DNS
 * resolution. Self-hosters running n8n on a private network can opt in with
 * ALLOW_PRIVATE_INTEGRATION_URLS=true. Always pair with `redirect: "manual"`.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast / reserved
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    if (x.startsWith("::ffff:")) return isPrivateAddress(x.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true; // not an IP: treat as unsafe
}

export function privateUrlsAllowed() {
  return process.env.ALLOW_PRIVATE_INTEGRATION_URLS === "true" || process.env.NODE_ENV !== "production";
}

export async function assertSafeOutboundUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed");
  if (privateUrlsAllowed()) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error("Destination address is not allowed");
  return url;
}
