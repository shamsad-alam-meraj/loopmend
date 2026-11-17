import "server-only";
import type { AuthContext } from "@/lib/auth";

/** Counts shown next to sidebar items (open incidents, pending approvals). Extended by later modules. */
export async function getSidebarBadges(auth: AuthContext): Promise<Partial<Record<string, number>>> {
  void auth;
  return {};
}
