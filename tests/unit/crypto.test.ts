import { describe, expect, it } from "vitest";
import { decryptJson, decryptSecret, encryptJson, encryptSecret, safeEqual, secretHint } from "@/lib/security/crypto";
import { hashPassword, verifyPassword } from "@/lib/security/password";

describe("secret encryption", () => {
  it("round-trips and never contains plaintext", () => {
    const ct = encryptSecret("n8n_api_key_super_secret");
    expect(ct.startsWith("v1:")).toBe(true);
    expect(ct).not.toContain("super_secret");
    expect(decryptSecret(ct)).toBe("n8n_api_key_super_secret");
    expect(decryptJson(encryptJson({ apiKey: "x" }))).toEqual({ apiKey: "x" });
  });
  it("detects tampering and wrong AAD", () => {
    const ct = encryptSecret("value", "org-1");
    const parts = ct.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join(":"), "org-1")).toThrow();
    expect(() => decryptSecret(ct, "org-2")).toThrow();
  });
  it("compares in constant time and hints", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(secretHint("abcdef1234")).toBe("••••1234");
  });
});

describe("password hashing", () => {
  it("verifies correct and rejects wrong passwords", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
});
