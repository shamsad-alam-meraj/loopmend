import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { memberships, organizations, profiles, type Role } from "@schema";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/utils/errors";
import { slugify } from "@/lib/utils/format";
import { assignableRoles } from "@/lib/security/rbac";
import { authorize, type ServiceContext } from "./context";
import { recordAudit } from "./audit.service";
import { randomBytes } from "node:crypto";

export async function listUserMemberships(userId: string) {
  const db = await getDb();
  return db
    .select({ organization: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(organizations.name));
}

/** Creates an organization with the creator as owner. */
export async function createOrganization(userId: string, name: string, requestId?: string) {
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 80) throw new AppError("VALIDATION_FAILED", "Organization name must be 2–80 characters");
  const db = await getDb();
  return db.transaction(async (tx) => {
    let slug = slugify(clean) || "org";
    const [taken] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
    if (taken) slug = `${slug}-${randomBytes(3).toString("hex")}`;
    const [org] = await tx.insert(organizations).values({ name: clean, slug }).returning();
    await tx.insert(memberships).values({ organizationId: org.id, userId, role: "owner" });
    await recordAudit(tx, { organizationId: org.id, actor: { type: "user", id: userId }, role: "owner", requestId }, {
      action: "organization.created",
      targetType: "organization",
      targetId: org.id,
      metadata: { name: clean, slug },
    });
    return org;
  });
}

export async function listMembers(ctx: ServiceContext) {
  authorize(ctx, "dashboard:read");
  const db = await getDb();
  return db
    .select({ id: memberships.id, role: memberships.role, createdAt: memberships.createdAt, userId: profiles.id, email: profiles.email, fullName: profiles.fullName })
    .from(memberships)
    .innerJoin(profiles, eq(memberships.userId, profiles.id))
    .where(eq(memberships.organizationId, ctx.organizationId))
    .orderBy(asc(profiles.email));
}

async function ownerCount(orgId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner")));
  return row.n;
}

/** Adds an existing user (by email) to the organization. */
export async function addMember(ctx: ServiceContext, email: string, role: Role) {
  authorize(ctx, "member:manage");
  if (!assignableRoles(ctx.role!).includes(role)) throw new AppError("FORBIDDEN", `You cannot assign the ${role} role`);
  const db = await getDb();
  const [user] = await db.select().from(profiles).where(eq(profiles.email, email.trim().toLowerCase()));
  if (!user) throw new AppError("NOT_FOUND", "No user with that email has signed up yet");
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.userId, user.id)));
    if (existing) throw new AppError("CONFLICT", "That user is already a member");
    const [m] = await tx.insert(memberships).values({ organizationId: ctx.organizationId, userId: user.id, role }).returning();
    await recordAudit(tx, ctx, { action: "member.added", targetType: "membership", targetId: m.id, metadata: { email: user.email, role } });
    return m;
  });
}

export async function changeMemberRole(ctx: ServiceContext, membershipId: string, role: Role) {
  authorize(ctx, "member:manage");
  if (!assignableRoles(ctx.role!).includes(role)) throw new AppError("FORBIDDEN", `You cannot assign the ${role} role`);
  const db = await getDb();
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, ctx.organizationId)));
  if (!m) throw new AppError("NOT_FOUND", "Membership not found");
  if (m.role === "owner" && ctx.role !== "owner") throw new AppError("FORBIDDEN", "Only owners can change an owner's role");
  if (m.role === "owner" && role !== "owner" && (await ownerCount(ctx.organizationId)) <= 1) {
    throw new AppError("POLICY_VIOLATION", "An organization must keep at least one owner");
  }
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(memberships).set({ role }).where(eq(memberships.id, m.id)).returning();
    await recordAudit(tx, ctx, { action: "member.role_changed", targetType: "membership", targetId: m.id, metadata: { from: m.role, to: role } });
    return updated;
  });
}

export async function removeMember(ctx: ServiceContext, membershipId: string) {
  authorize(ctx, "member:manage");
  const db = await getDb();
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, ctx.organizationId)));
  if (!m) throw new AppError("NOT_FOUND", "Membership not found");
  if (m.role === "owner" && ctx.role !== "owner") throw new AppError("FORBIDDEN", "Only owners can remove an owner");
  if (m.role === "owner" && (await ownerCount(ctx.organizationId)) <= 1) {
    throw new AppError("POLICY_VIOLATION", "An organization must keep at least one owner");
  }
  await db.transaction(async (tx) => {
    await tx.delete(memberships).where(eq(memberships.id, m.id));
    await recordAudit(tx, ctx, { action: "member.removed", targetType: "membership", targetId: m.id, metadata: { userId: m.userId, role: m.role } });
  });
}
