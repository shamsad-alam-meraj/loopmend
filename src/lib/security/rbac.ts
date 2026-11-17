import type { Role } from "@schema";

export const ROLE_RANK: Record<Role, number> = { viewer: 1, operator: 2, admin: 3, owner: 4 };

/**
 * Permission matrix (docs §10 Roles):
 *  owner    – full organization administration and ownership controls
 *  admin    – manage integrations, workflows, members, settings
 *  operator – investigate incidents and approve permitted recoveries
 *  viewer   – read-only dashboards and incident history
 */
export const PERMISSIONS = {
  "dashboard:read": "viewer",
  "incident:read": "viewer",
  "incident:update": "operator",
  "incident:investigate": "operator",
  "recovery:create": "operator",
  "recovery:approve": "operator",
  "recovery:execute": "operator",
  "recovery:approve_high_risk": "admin",
  "workflow:manage": "admin",
  "integration:manage": "admin",
  "member:manage": "admin",
  "audit:read": "operator",
  "org:delete": "owner",
  "org:transfer": "owner",
  "demo:simulate": "operator",
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

export function hasRole(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return hasRole(role, PERMISSIONS[permission]);
}

/** Roles an actor may assign: admins manage up to operator/admin, only owners mint owners. */
export function assignableRoles(actor: Role): Role[] {
  if (actor === "owner") return ["owner", "admin", "operator", "viewer"];
  if (actor === "admin") return ["admin", "operator", "viewer"];
  return [];
}
