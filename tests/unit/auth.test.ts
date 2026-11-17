import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session-token";
import { assignableRoles, can } from "@/lib/security/rbac";
import { authorize, systemContext } from "@/services/context";

const SECRET = "x".repeat(40);

describe("session tokens", () => {
  it("verifies a valid token and rejects tampering, wrong secret, expiry", () => {
    const now = Date.parse("2026-11-17T10:00:00Z");
    const token = createSessionToken("user-1", SECRET, now);
    expect(verifySessionToken(token, SECRET, now)?.sub).toBe("user-1");
    expect(verifySessionToken(token, "y".repeat(40), now)).toBeNull();
    const [data, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", iat: 0, exp: 9e9 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(verifySessionToken(`${data}.`, SECRET, now)).toBeNull();
    expect(verifySessionToken(token, SECRET, now + 8 * 86_400_000)).toBeNull();
    expect(verifySessionToken(undefined, SECRET)).toBeNull();
  });
});

describe("RBAC", () => {
  it("matches the documented role permissions", () => {
    expect(can("viewer", "incident:read")).toBe(true);
    expect(can("viewer", "incident:investigate")).toBe(false);
    expect(can("viewer", "recovery:approve")).toBe(false);
    expect(can("operator", "recovery:approve")).toBe(true);
    expect(can("operator", "recovery:approve_high_risk")).toBe(false);
    expect(can("operator", "integration:manage")).toBe(false);
    expect(can("admin", "integration:manage")).toBe(true);
    expect(can("admin", "org:delete")).toBe(false);
    expect(can("owner", "org:delete")).toBe(true);
    expect(can(null, "incident:read")).toBe(false);
  });
  it("limits which roles each actor can assign", () => {
    expect(assignableRoles("owner")).toContain("owner");
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(assignableRoles("operator")).toEqual([]);
  });
  it("enforces at the service boundary for users, not machine actors", () => {
    expect(() => authorize({ organizationId: "o", actor: { type: "user", id: "u" }, role: "viewer" }, "recovery:approve")).toThrow(/cannot perform/);
    expect(() => authorize(systemContext("o"), "incident:update")).not.toThrow();
  });
});
