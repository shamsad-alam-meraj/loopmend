import "server-only";
import { toServiceContext, type AuthContext } from "@/lib/auth";
import { getIncidentCounts } from "@/services/incident.service";

/** Counts shown next to sidebar items (open incidents, pending approvals). */
export async function getSidebarBadges(auth: AuthContext): Promise<Partial<Record<string, number>>> {
  const ctx = toServiceContext(auth);
  const counts = await getIncidentCounts(ctx);
  return { "/incidents": counts.active, "/approvals": counts.byStatus.awaiting_approval ?? 0 };
}
