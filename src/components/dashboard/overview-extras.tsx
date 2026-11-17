import type { AuthContext } from "@/lib/auth";

/** Extension point for anomaly and recovery widgets (analytics/recovery modules). */
export async function OverviewExtras({ auth }: { auth: AuthContext }) {
  void auth;
  return null;
}
