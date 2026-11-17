import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, Clock, Gauge, Siren, Timer } from "lucide-react";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { can } from "@/lib/security/rbac";
import { getIncidentCounts, listIncidents } from "@/services/incident.service";
import { executionTimeline, listWorkflows } from "@/services/workflow.service";
import { incidentResponseTimes, reliabilitySummary } from "@/services/reliability.service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { buttonVariants } from "@/components/ui/button";
import { ExecutionChart } from "@/components/charts/execution-chart";
import { SimulateFailure } from "@/components/incidents/simulate-failure";
import { HealthBadge, incidentRef, SeverityBadge, StatusBadge } from "@/components/incidents/badges";
import { formatDuration, formatPercent, formatRelative } from "@/lib/utils/format";
import { OverviewExtras } from "@/components/dashboard/overview-extras";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const auth = await requirePageAuth();
  const ctx = toServiceContext(auth);
  const [counts, summary, response, timeline, recent, wfs] = await Promise.all([
    getIncidentCounts(ctx),
    reliabilitySummary(ctx, 24),
    incidentResponseTimes(ctx, 30),
    executionTimeline(ctx, { hours: 24 }),
    listIncidents(ctx, { view: "active", status: [], severity: [], category: [], limit: 6 }),
    listWorkflows(ctx),
  ]);
  const unhealthy = wfs.filter((w) => w.health === "failing" || w.health === "degraded");

  return (
    <>
      <PageHeader title="Overview" description={`${auth.org.name} · reliability at a glance`} actions={<Link href="/incidents" className={buttonVariants({ size: "sm" })}>View incidents</Link>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Active incidents" value={counts.active} icon={<Siren />} tone={counts.active ? "danger" : "success"} hint={`${counts.byStatus.awaiting_approval ?? 0} awaiting approval`} />
        <Stat label="High / critical" value={counts.activeHighOrCritical} icon={<AlertTriangle />} tone={counts.activeHighOrCritical ? "warning" : undefined} hint="active incidents" />
        <Stat label="Success rate (24h)" value={formatPercent(summary.successRate)} icon={<Gauge />} hint={`${summary.failures} failed of ${summary.runs}`} tone={(summary.successRate ?? 1) < 0.95 ? "danger" : "success"} />
        <Stat label="p95 duration (24h)" value={formatDuration(summary.p95Ms)} icon={<Timer />} hint={`${summary.runs} executions`} />
        <Stat label="MTTR (30d)" value={formatDuration(response.mttrMs)} icon={<Clock />} hint={`MTTA ${formatDuration(response.mttaMs)} · ${response.resolved} resolved`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader><CardTitle>Executions · last 24 hours</CardTitle><CardDescription>All monitored workflows, hourly (UTC).</CardDescription></CardHeader>
            <CardContent><ExecutionChart data={timeline} /></CardContent>
          </Card>
          <OverviewExtras auth={auth} />
          {can(auth.role, "demo:simulate") && (
            <Card id="simulator" className="scroll-mt-6">
              <CardHeader>
                <CardTitle>Failure simulator</CardTitle>
                <CardDescription>Sends a signed n8n Error Trigger payload through the public webhook — the same path real failures take.</CardDescription>
              </CardHeader>
              <CardContent><SimulateFailure workflows={wfs.map((w) => ({ id: w.id, name: w.name }))} /></CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Active incidents</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {recent.items.length === 0 && <p className="text-xs text-muted-foreground">All clear — no active incidents.</p>}
              {recent.items.map((i) => (
                <Link key={i.id} href={`/incidents/${i.id}`} className="block rounded-md border p-2.5 hover:bg-muted">
                  <div className="flex items-center gap-2 text-xs"><span className="font-mono text-muted-foreground">{incidentRef(i.number)}</span><SeverityBadge severity={i.severity} /><StatusBadge status={i.status} /></div>
                  <div className="mt-1 truncate text-sm font-medium">{i.workflowName}</div>
                  <div className="truncate text-xs text-muted-foreground">{i.errorMessage} · {formatRelative(i.lastSeenAt)}</div>
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Workflow health</CardTitle><CardDescription>{unhealthy.length} of {wfs.length} need attention</CardDescription></CardHeader>
            <CardContent className="space-y-1.5">
              {wfs.map((w) => (
                <Link key={w.id} href={`/workflows/${w.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <span className="flex min-w-0 items-center gap-2 truncate"><Activity className="size-3.5 text-muted-foreground" />{w.name}</span>
                  <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">{formatPercent(w.stats.successRate)}<HealthBadge health={w.health} /></span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
