import { toServiceContext, type AuthContext } from "@/lib/auth";
import { can } from "@/lib/security/rbac";
import { listInvestigations } from "@/services/investigation.service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InvestigateButton } from "@/components/investigations/investigate-button";
import { InvestigationCard } from "@/components/investigations/investigation-card";
import { formatRelative, titleCase } from "@/lib/utils/format";
import { RecoverySection } from "@/components/recoveries/recovery-section";

/** Investigation and recovery sections of the incident page. */
export async function IncidentExtraSections({ auth, incidentId }: { auth: AuthContext; incidentId: string }) {
  const rows = await listInvestigations(toServiceContext(auth), { incidentId, limit: 10 });
  const [latest, ...older] = rows;
  const canInvestigate = can(auth.role, "incident:investigate");
  return (
    <>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Investigation</CardTitle>
            <CardDescription>Sanitized execution metadata and related incidents are analyzed; output is schema-validated.</CardDescription>
          </div>
          {canInvestigate && <InvestigateButton incidentId={incidentId} label={latest ? "Re-investigate" : "Run investigation"} />}
        </CardHeader>
        <CardContent>
          {latest ? <InvestigationCard inv={latest.investigation} /> : <p className="text-xs text-muted-foreground">Not investigated yet.</p>}
          {older.length > 0 && (
            <details className="mt-4 text-xs">
              <summary className="cursor-pointer text-muted-foreground">{older.length} earlier investigation(s)</summary>
              <ul className="mt-2 space-y-1">
                {older.map(({ investigation: o }) => (
                  <li key={o.id} className="text-muted-foreground">
                    {formatRelative(o.createdAt)} · {o.provider} · {o.rootCauseSummary ?? o.status} {o.diagnosis ? `→ ${titleCase(String((o.diagnosis as { recommendation?: { strategy?: string } }).recommendation?.strategy ?? ""))}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>
      <RecoverySection auth={auth} incidentId={incidentId} />
    </>
  );
}
