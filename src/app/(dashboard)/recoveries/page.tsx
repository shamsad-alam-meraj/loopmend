import type { Metadata } from "next";
import Link from "next/link";
import { Undo2 } from "lucide-react";
import type { RecoveryStatus } from "@schema";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { listRecoveryPlans } from "@/services/recovery.service";
import { STRATEGY_INFO } from "@/lib/recovery/policy";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { incidentRef } from "@/components/incidents/badges";
import { PlanStatusBadge, RiskBadge } from "@/components/recoveries/badges";
import { formatRelative } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Recoveries" };

const TABS: { key: string; label: string; status: RecoveryStatus[] }[] = [
  { key: "active", label: "Active", status: ["pending_approval", "approved", "executing"] },
  { key: "dead_letter", label: "Dead letter", status: ["dead_letter"] },
  { key: "done", label: "Completed", status: ["succeeded", "rejected", "cancelled", "failed"] },
  { key: "all", label: "All", status: [] },
];

export default async function RecoveriesPage({ searchParams }: PageProps<"/recoveries">) {
  const auth = await requirePageAuth("incident:read");
  const tabKey = (await searchParams).tab;
  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0];
  const rows = await listRecoveryPlans(toServiceContext(auth), { status: tab.status, limit: 100 });
  return (
    <>
      <PageHeader title="Recoveries" description="Recovery plans, attempts and the dead-letter queue for exhausted or ambiguous operations." />
      <div className="mb-4 flex w-fit gap-1 rounded-lg border bg-card p-1">
        {TABS.map((t) => (
          <Link key={t.key} href={`/recoveries?tab=${t.key}`} className={cn("rounded-md px-3 py-1 text-xs font-medium", t.key === tab.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>{t.label}</Link>
        ))}
      </div>
      <Card>
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={<Undo2 />} title={tab.key === "dead_letter" ? "Dead-letter queue is empty" : "No recovery plans"} description="Plans are proposed after investigations or by operators." /></div>
        ) : (
          <Table>
            <THead><TR><TH>Incident</TH><TH>Strategy</TH><TH>Status</TH><TH>Risk</TH><TH className="text-right">Attempts</TH><TH>Note</TH><TH>Updated</TH></TR></THead>
            <TBody>
              {rows.map(({ plan, incidentNumber, workflowName }) => (
                <TR key={plan.id}>
                  <TD><Link href={`/incidents/${plan.incidentId}`} className="hover:text-primary"><span className="font-mono text-xs text-muted-foreground">{incidentRef(incidentNumber)}</span> <span className="font-medium">{workflowName}</span></Link></TD>
                  <TD className="text-xs">{STRATEGY_INFO[plan.strategy].label}</TD>
                  <TD><PlanStatusBadge status={plan.status} /></TD>
                  <TD><RiskBadge risk={plan.riskLevel} /></TD>
                  <TD className="text-right tabular-nums text-xs">{plan.attemptsUsed}/{plan.maxAttempts}</TD>
                  <TD className="max-w-xs truncate text-xs text-muted-foreground">{plan.deadLetterReason ?? plan.rationale ?? ""}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(plan.updatedAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
