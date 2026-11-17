import type { AuthContext } from "@/lib/auth";

/** Investigation and recovery sections (filled in by the AI and recovery modules). */
export async function IncidentExtraSections({ auth, incidentId }: { auth: AuthContext; incidentId: string }) {
  void auth;
  void incidentId;
  return null;
}
