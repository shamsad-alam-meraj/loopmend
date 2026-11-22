import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, readLimited, safeRedirectPath } from "@/lib/http/request-safety";
import { assertSafeOutboundUrl, isPrivateAddress } from "@/lib/security/outbound-url";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session-token";

describe("safeRedirectPath (open redirect)", () => {
  it.each(["/\\evil.com", "/%09/evil.com", "/\t/evil.com", "//evil.com", "https://evil.com", "javascript:alert(1)", "/\\/evil.com", "", null, 42])("rejects %j", (v) => {
    expect(safeRedirectPath(v)).toBe("/overview");
  });
  it("keeps same-origin paths with query and hash", () => {
    expect(safeRedirectPath("/incidents?view=all#x")).toBe("/incidents?view=all#x");
    expect(safeRedirectPath("/approvals")).toBe("/approvals");
  });
});

describe("clientIp (rate-limit key)", () => {
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  it("prefers platform headers and the right-most forwarded hop", () => {
    expect(clientIp(h({ "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "6.6.6.6" }))).toBe("1.1.1.1");
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(h({}))).toBe("local");
  });
});

describe("readLimited (body cap without full buffering)", () => {
  const stream = (chunks: number, size: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < chunks; i++) c.enqueue(new Uint8Array(size).fill(97));
        c.close();
      },
    });
  it("stops reading once the limit is exceeded", async () => {
    expect(await readLimited(stream(100, 64 * 1024), 256 * 1024)).toEqual({ text: "", tooLarge: true });
    const ok = await readLimited(stream(2, 10), 100);
    expect(ok).toEqual({ text: "a".repeat(20), tooLarge: false });
  });
});

describe("outbound URL guard (SSRF)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("classifies private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("blocks internal destinations in production unless explicitly allowed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(assertSafeOutboundUrl("http://127.0.0.1:5678/api")).rejects.toThrow(/not allowed/);
    await expect(assertSafeOutboundUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/not allowed/);
    await expect(assertSafeOutboundUrl("https://user:pw@example.com")).rejects.toThrow(/Credentials/);
    await expect(assertSafeOutboundUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    vi.stubEnv("ALLOW_PRIVATE_INTEGRATION_URLS", "true");
    await expect(assertSafeOutboundUrl("http://127.0.0.1:5678/api")).resolves.toBeInstanceOf(URL);
  });
});

describe("session tokens carry a revocation version", () => {
  it("embeds the version", () => {
    const secret = "s".repeat(40);
    expect(verifySessionToken(createSessionToken("u", secret, Date.now(), 3), secret)?.ver).toBe(3);
  });
});
