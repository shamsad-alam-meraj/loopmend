import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@schema";
import { secrets } from "@/lib/env";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, type Permission } from "@/lib/security/rbac";
import { AppError } from "@/lib/utils/errors";
import { currentSessionVersion, ensureProfile, findUserForSession, revokeSessions, type SessionUser } from "@/services/user.service";
import { listUserMemberships } from "@/services/organization.service";
import type { ServiceContext } from "@/services/context";
import { createSessionToken, ORG_COOKIE, SESSION_COOKIE, SESSION_TTL_SECONDS, verifySessionToken } from "./session-token";

export type OrgSummary = { id: string; name: string; slug: string; isDemo: boolean };
export type AuthContext = {
  user: SessionUser;
  org: OrgSummary;
  role: Role;
  memberships: { org: OrgSummary; role: Role }[];
};

/** Current user from Supabase Auth or the local signed session cookie. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  if (isSupabaseConfigured) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user?.email) return null;
    return ensureProfile(data.user.id, data.user.email, (data.user.user_metadata?.full_name as string | undefined) ?? null);
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = verifySessionToken(token, secrets.session());
  if (!payload) return null;
  return findUserForSession(payload.sub, payload.ver ?? 0);
});

/** Resolves user + active organization + role. `preferredOrg` may be an id or slug. */
export const getAuthContext = cache(async (preferredOrg?: string | null): Promise<AuthContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const rows = await listUserMemberships(user.id);
  if (rows.length === 0) return { user, org: null as unknown as OrgSummary, role: null as unknown as Role, memberships: [] };
  const memberships = rows.map((r) => ({
    org: { id: r.organization.id, name: r.organization.name, slug: r.organization.slug, isDemo: r.organization.isDemo },
    role: r.role,
  }));
  const wanted = preferredOrg ?? (await cookies()).get(ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.org.id === wanted || m.org.slug === wanted) ?? memberships[0];
  return { user, org: active.org, role: active.role, memberships };
});

export function toServiceContext(auth: AuthContext, requestId?: string): ServiceContext {
  return { organizationId: auth.org.id, actor: { type: "user", id: auth.user.id }, role: auth.role, requestId };
}

/** For Server Components / Server Actions: redirects when unauthenticated, throws when forbidden. */
export async function requirePageAuth(permission: Permission = "dashboard:read"): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  if (auth.memberships.length === 0) redirect("/onboarding");
  if (!can(auth.role, permission)) throw new AppError("FORBIDDEN", "You do not have access to this page");
  return auth;
}

/** For Route Handlers: organization from `x-organization-id` header or the active-org cookie. */
export async function requireApiAuth(permission: Permission): Promise<AuthContext> {
  const orgHeader = (await headers()).get("x-organization-id");
  const auth = await getAuthContext(orgHeader);
  if (!auth) throw new AppError("UNAUTHENTICATED", "Sign in required");
  if (auth.memberships.length === 0) throw new AppError("FORBIDDEN", "You are not a member of any organization");
  if (orgHeader && auth.org.id !== orgHeader && auth.org.slug !== orgHeader) {
    throw new AppError("FORBIDDEN", "You are not a member of that organization");
  }
  if (!can(auth.role, permission)) throw new AppError("FORBIDDEN", `Your role (${auth.role}) cannot perform ${permission}`);
  return auth;
}

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/** Local auth only: issue the signed session cookie. */
export async function startLocalSession(userId: string) {
  const store = await cookies();
  const version = await currentSessionVersion(userId);
  store.set(SESSION_COOKIE, createSessionToken(userId, secrets.session(), Date.now(), version), { ...cookieBase, maxAge: SESSION_TTL_SECONDS });
}

export async function setActiveOrg(orgId: string) {
  (await cookies()).set(ORG_COOKIE, orgId, { ...cookieBase, maxAge: 60 * 60 * 24 * 365 });
}

export async function endSession() {
  if (!isSupabaseConfigured) {
    // Invalidate the token server-side too, so a copied cookie stops working.
    const payload = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value, secrets.session());
    if (payload) await revokeSessions(payload.sub);
  }
  if (isSupabaseConfigured) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(ORG_COOKIE);
}
