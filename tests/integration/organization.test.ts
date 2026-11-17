import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../support/db";
import { seedDemo } from "@/lib/db/seed";
import { addMember, changeMemberRole, createOrganization, listMembers, removeMember } from "@/services/organization.service";
import { createLocalUser, verifyLocalCredentials } from "@/services/user.service";
import { listAuditLogs } from "@/services/audit.service";
import type { ServiceContext } from "@/services/context";

let close: () => Promise<void>;
let ids: Awaited<ReturnType<typeof seedDemo>>;
const ctx = (orgId: string, userId: string, role: ServiceContext["role"]): ServiceContext => ({ organizationId: orgId, actor: { type: "user", id: userId }, role });

beforeAll(async () => {
  const t = await createTestDb();
  close = t.close;
  ids = await seedDemo(t.db, Date.now(), { days: 3 });
});
afterAll(async () => close());

describe("organizations & membership", () => {
  it("registers a user, creates an org as owner, and audits it", async () => {
    const user = await createLocalUser("new@company.test", "a-long-password", "New User");
    expect(await verifyLocalCredentials("NEW@company.test", "a-long-password")).toMatchObject({ id: user.id });
    expect(await verifyLocalCredentials("new@company.test", "wrong-password")).toBeNull();
    const org = await createOrganization(user.id, "New Co");
    const owner = ctx(org.id, user.id, "owner");
    const members = await listMembers(owner);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
    const audit = await listAuditLogs(owner);
    expect(audit.map((a) => a.action)).toContain("organization.created");
  });

  it("prevents admins from minting owners and viewers from managing members", async () => {
    const admin = ctx(ids.acme, ids.userIds.get("admin@demo.loopmend.dev")!, "admin");
    const viewer = ctx(ids.acme, ids.userIds.get("viewer@demo.loopmend.dev")!, "viewer");
    await expect(addMember(admin, "owner@globex.loopmend.dev", "owner")).rejects.toThrow(/cannot assign/);
    await expect(addMember(viewer, "owner@globex.loopmend.dev", "viewer")).rejects.toThrow(/cannot perform member:manage/);
    const m = await addMember(admin, "owner@globex.loopmend.dev", "viewer");
    await expect(addMember(admin, "owner@globex.loopmend.dev", "viewer")).rejects.toThrow(/already a member/);
    await changeMemberRole(admin, m.id, "operator");
    await removeMember(admin, m.id);
  });

  it("keeps at least one owner", async () => {
    const ownerId = ids.userIds.get("owner@globex.loopmend.dev")!;
    const owner = ctx(ids.globex, ownerId, "owner");
    const [self] = await listMembers(owner);
    await expect(changeMemberRole(owner, self.id, "admin")).rejects.toThrow(/at least one owner/);
    await expect(removeMember(owner, self.id)).rejects.toThrow(/at least one owner/);
  });

  it("cannot touch memberships of another organization", async () => {
    const acmeAdmin = ctx(ids.acme, ids.userIds.get("admin@demo.loopmend.dev")!, "admin");
    const globexMembers = await listMembers(ctx(ids.globex, ids.userIds.get("owner@globex.loopmend.dev")!, "owner"));
    await expect(removeMember(acmeAdmin, globexMembers[0].id)).rejects.toThrow(/not found/i);
  });
});
