import type { Metadata } from "next";
import Link from "next/link";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { reliabilityReport } from "@/services/reliability.service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CategoryChart, SuccessRateChart } from "@/components/charts/reliability-charts";
import { AnomalyList } from "@/components/analytics/anomaly-list";
import { formatDuration, formatPercent } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Analytics" };

const WINDOWS = [1, 7, 14, 30];

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const auth = await requirePageAuth();
  const days = WINDOWS.includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 7;
  const r = await reliabilityReport(toServiceContext(auth), days);
  return (
    <>
      <PageHeader
        title="Reliability analytics"
        description="Measured from ingested executions. SLO targets are set by workflow criticality."
        actions={
          <div className="flex gap-1 rounded-lg border bg-card p-1">
            {WINDOWS.map((w) => (
              <Link key={w} href={`/analytics?days=${w}`} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", w === days ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>{w}d</Link>
            ))}
          </div>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Success rate" value={formatPercent(r.summary.successRate, 2)} hint={`${r.summary.runs} executions`} />
        <Stat label="p95 duration" value={formatDuration(r.summary.p95Ms)} />
        <Stat label="MTTR / MTTA" value={formatDuration(r.response.mttrMs)} hint={`MTTA ${formatDuration(r.response.mttaMs)}`} />
        <Stat label="Recovery plan success" value={formatPercent(r.recovery.planSuccessRate)} hint={`${r.recovery.plans.dead_letter ?? 0} dead-lettered`} />
        <Stat label="Recovery attempt success" value={formatPercent(r.recovery.attemptSuccessRate)} hint={`${r.recovery.attempts} attempts`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader><CardTitle>Daily executions & success rate</CardTitle></CardHeader>
            <CardContent><SuccessRateChart data={r.daily} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>SLOs & error budgets</CardTitle><CardDescription>Availability = successful executions / all executions over {days}d.</CardDescription></CardHeader>
            <Table>
              <THead><TR><TH>Workflow</TH><TH className="text-right">Runs</TH><TH className="text-right">Success</TH><TH className="text-right">Target</TH><TH>Error budget remaining</TH><TH className="text-right">p95</TH></TR></THead>
              <TBody>
                {r.workflows.map((w) => {
                  const remaining = w.slo.remaining;
                  return (
                    <TR key={w.id}>
                      <TD><Link href={`/workflows/${w.id}`} className="font-medium hover:text-primary">{w.name}</Link><div className="text-[11px] capitalize text-muted-foreground">{w.criticality}</div></TD>
                      <TD className="text-right tabular-nums">{w.runs}</TD>
                      <TD className="text-right tabular-nums">{formatPercent(w.successRate, 2)}</TD>
                      <TD className="text-right tabular-nums text-muted-foreground">{formatPercent(w.slo.target, 1)}</TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full", remaining > 0.5 ? "bg-success" : remaining > 0 ? "bg-warning" : "bg-destructive")} style={{ width: `${Math.round(remaining * 100)}%` }} />
                          </div>
                          <span className={cn("text-xs tabular-nums", remaining === 0 && w.runs > 0 && "text-destructive")}>{w.runs ? (remaining === 0 ? "exhausted" : formatPercent(remaining, 0)) : "—"}</span>
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums text-xs">{formatDuration(w.p95Ms)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Anomalies</CardTitle><CardDescription>Last 6h vs. 7-day hourly baseline (z-score / MAD).</CardDescription></CardHeader>
            <CardContent><AnomalyList items={r.anomalies} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Incidents by category</CardTitle></CardHeader>
            <CardContent><CategoryChart data={r.incidentsByCategory} /></CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
