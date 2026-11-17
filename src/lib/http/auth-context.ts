import "server-only";
import { requireApiAuth, toServiceContext } from "@/lib/auth";
import type { Permission } from "@/lib/security/rbac";

/** Authenticates the caller for a REST endpoint and returns a tenant-scoped service context. */
export async function apiContext(permission: Permission, requestId: string) {
  const auth = await requireApiAuth(permission);
  return { auth, ctx: toServiceContext(auth, requestId) };
}
