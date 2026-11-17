import type { Metadata } from "next";
import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { can } from "@/lib/security/rbac";
import { getRecoveryPlan, listRecoveryPlans } from "@/services/recovery.service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { incidentRef } from "@/components/incidents/badges";
import { PlanCard } from "@/components/recoveries/plan-card";
import { formatRelative, titleCase } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const auth = await requirePageAuth("incident:read");
  const ctx = toServiceContext(auth);
  const pending = await listRecoveryPlans(ctx, { status: ["pending_approval"], limit: 50 });
  const details = await Promise.all(pending.map((p) => getRecoveryPlan(ctx, p.plan.id)));
  const recent = await listRecoveryPlans(ctx, { status: ["approved", "rejected", "succeeded", "dead_letter", "executing"], limit: 15 });
  return (
    <>
      <PageHeader title="Approvals" description="Human-in-the-loop gate for recovery plans. Every decision is recorded in the append-only audit log." />
      <div className="space-y-6">
        {pending.length === 0 ? (
          <EmptyState icon={<CheckCheck />} title="Nothing awaiting approval" description="Plans that need a human decision will appear here." />
        ) : (
          pending.map((p, i) => (
            <Card key={p.plan.id}>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle>
                  <Link href={`/incidents/${p.plan.incidentId}`} className="hover:text-primary"><span className="font-mono text-muted-foreground">{incidentRef(p.incidentNumber)}</span> · {p.workflowName}</Link>
                </CardTitle>
                <span className="text-xs text-muted-foreground">{titleCase(p.sideEffectProfile)} · requested by {p.requesterEmail ?? "system"} {formatRelative(p.plan.createdAt)}</span>
              </CardHeader>
              <CardContent><PlanCard detail={details[i]} canApprove={can(auth.role, "recovery:approve")} canExecute={can(auth.role, "recovery:execute")} currentUserId={auth.user.id} /></CardContent>
            </Card>
          ))
        )}
        {recent.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Recently decided</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {recent.map((p) => (
                <Link key={p.plan.id} href={`/incidents/${p.plan.incidentId}`} className="flex justify-between gap-2 rounded px-2 py-1 hover:bg-muted">
                  <span><span className="font-mono text-xs text-muted-foreground">{incidentRef(p.incidentNumber)}</span> {p.workflowName} · {titleCase(p.plan.strategy)}</span>
                  <span className="text-xs text-muted-foreground">{titleCase(p.plan.status)} · {formatRelative(p.plan.updatedAt)}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
