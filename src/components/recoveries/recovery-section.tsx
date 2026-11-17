import { toServiceContext, type AuthContext } from "@/lib/auth";
import { can } from "@/lib/security/rbac";
import { getRecoveryPlan, listRecoveryPlans } from "@/services/recovery.service";
import { listInvestigations } from "@/services/investigation.service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanCard } from "./plan-card";
import { ProposeForm } from "./plan-controls";

/** Recovery plans for an incident: policy, approvals, attempts and controls. */
export async function RecoverySection({ auth, incidentId, incidentClosed }: { auth: AuthContext; incidentId: string; incidentClosed: boolean }) {
  const ctx = toServiceContext(auth);
  const plans = await listRecoveryPlans(ctx, { incidentId, limit: 10 });
  const details = await Promise.all(plans.map((p) => getRecoveryPlan(ctx, p.plan.id)));
  const active = plans.some((p) => ["pending_approval", "approved", "executing"].includes(p.plan.status));
  const [latestInv] = await listInvestigations(ctx, { incidentId, limit: 1 });
  const recommended = (latestInv?.investigation.diagnosis as { recommendation?: { strategy?: string } } | null)?.recommendation?.strategy;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery</CardTitle>
        <CardDescription>Allowlisted strategies only. Deterministic policy sets risk, approvals, retry budget and deadline.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {details.length === 0 && <p className="text-xs text-muted-foreground">No recovery plan yet.</p>}
        {details.map((d) => (
          <PlanCard key={d.plan.id} detail={d} canApprove={can(auth.role, "recovery:approve")} canExecute={can(auth.role, "recovery:execute")} currentUserId={auth.user.id} />
        ))}
        {!active && !incidentClosed && can(auth.role, "recovery:create") && <ProposeForm incidentId={incidentId} recommended={recommended} />}
      </CardContent>
    </Card>
  );
}
