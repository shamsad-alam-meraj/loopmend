import type { Metadata } from "next";
import Link from "next/link";
import { Workflow } from "lucide-react";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { listWorkflows } from "@/services/workflow.service";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { HealthBadge } from "@/components/incidents/badges";
import { formatDuration, formatPercent, formatRelative, titleCase } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Workflows" };

export default async function WorkflowsPage() {
  const auth = await requirePageAuth();
  const rows = await listWorkflows(toServiceContext(auth));
  return (
    <>
      <PageHeader title="Workflows" description="Monitored n8n workflows and their last-24h reliability." />
      <Card>
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={<Workflow />} title="No workflows yet" description="Workflows register automatically on their first event from n8n." /></div>
        ) : (
          <Table>
            <THead>
              <TR><TH>Workflow</TH><TH>Health</TH><TH className="text-right">Runs (24h)</TH><TH className="text-right">Success</TH><TH className="text-right">p95</TH><TH className="text-right">Open incidents</TH><TH>Side effects</TH><TH>Last run</TH></TR>
            </THead>
            <TBody>
              {rows.map((w) => (
                <TR key={w.id}>
                  <TD>
                    <Link href={`/workflows/${w.id}`} className="font-medium hover:text-primary">{w.name}</Link>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="capitalize">{w.criticality}</span> criticality {w.autoRecoveryEnabled && <Badge tone="info">auto-recovery</Badge>}</div>
                  </TD>
                  <TD><HealthBadge health={w.health} /></TD>
                  <TD className="text-right tabular-nums">{w.stats.runs}</TD>
                  <TD className="text-right tabular-nums">{formatPercent(w.stats.successRate)}</TD>
                  <TD className="text-right tabular-nums">{formatDuration(w.stats.p95Ms)}</TD>
                  <TD className="text-right tabular-nums">{w.openIncidents || "—"}</TD>
                  <TD className="text-xs">{titleCase(w.sideEffectProfile)}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(w.lastExecutionAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
