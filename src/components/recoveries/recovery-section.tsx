import type { AuthContext } from "@/lib/auth";

/** Recovery plans for an incident (filled in by the recovery module). */
export async function RecoverySection({ auth, incidentId }: { auth: AuthContext; incidentId: string }) {
  void auth;
  void incidentId;
  return null;
}
