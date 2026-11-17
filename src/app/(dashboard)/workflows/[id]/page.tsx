import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { executionTimeline, getWorkflow, listExecutions } from "@/services/workflow.service";
import { listIncidents } from "@/services/incident.service";
import { executionListQuery } from "@/lib/validation/query.schema";
import { can } from "@/lib/security/rbac";
import { isAppError } from "@/lib/utils/errors";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ExecutionChart } from "@/components/charts/execution-chart";
import { WorkflowSettingsForm } from "@/components/workflows/settings-form";
import { incidentRef, SeverityBadge, StatusBadge } from "@/components/incidents/badges";
import { formatDateTime, formatDuration, formatPercent, formatRelative } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Workflow" };

export default async function WorkflowPage({ params, searchParams }: PageProps<"/workflows/[id]">) {
  const auth = await requirePageAuth();
  const ctx = toServiceContext(auth);
  const { id } = await params;
  const sp = await searchParams;
  const q = executionListQuery.parse({ status: typeof sp.status === "string" ? sp.status : undefined, cursor: typeof sp.cursor === "string" ? sp.cursor : undefined, limit: 25 });
  const detail = await getWorkflow(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [execs, timeline, incidents] = await Promise.all([
    listExecutions(ctx, id, q),
    executionTimeline(ctx, { workflowId: id, hours: 24 * 7, bucket: "day" }),
    listIncidents(ctx, { workflowId: id, view: "all", status: [], severity: [], category: [], limit: 5 }),
  ]);
  const { workflow: w, stats } = detail;
  const filter = q.status[0];

  return (
    <>
      <Link href="/workflows" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" /> Workflows</Link>
      <PageHeader title={w.name} description={w.description ?? `External id ${w.externalId}`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Success rate (24h)" value={formatPercent(stats.day.successRate)} hint={`${stats.day.failures} of ${stats.day.runs} runs failed`} tone={(stats.day.successRate ?? 1) < 0.95 ? "danger" : "success"} />
        <Stat label="Success rate (7d)" value={formatPercent(stats.week.successRate)} hint={`${stats.week.runs} runs`} />
        <Stat label="p50 / p95 (24h)" value={`${formatDuration(stats.day.p50Ms)} / ${formatDuration(stats.day.p95Ms)}`} hint={`7d p95 ${formatDuration(stats.week.p95Ms)}`} />
        <Stat label="Last execution" value={formatRelative(w.lastExecutionAt)} hint={<span className="capitalize">{w.status}</span>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader><CardTitle>Executions · last 7 days</CardTitle></CardHeader>
            <CardContent><ExecutionChart data={timeline} granularity="day" /></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Execution history</CardTitle>
              <div className="flex gap-1 text-xs">
                {[["", "All"], ["error", "Failed"], ["success", "Succeeded"]].map(([v, l]) => (
                  <Link key={v} href={`/workflows/${id}${v ? `?status=${v}` : ""}`} className={cn("rounded-md px-2 py-1", (filter ?? "") === v ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>{l}</Link>
                ))}
              </div>
            </CardHeader>
            <Table>
              <THead><TR><TH>Execution</TH><TH>Status</TH><TH>Started</TH><TH className="text-right">Duration</TH><TH>Error</TH></TR></THead>
              <TBody>
                {execs.items.map((e) => (
                  <TR key={e.id}>
                    <TD className="font-mono text-xs">{e.externalId}{e.recoveryAttemptId && <Badge tone="primary" className="ml-2">recovery</Badge>}</TD>
                    <TD><Badge tone={e.status === "success" ? "success" : e.status === "error" || e.status === "crashed" ? "danger" : "neutral"}>{e.status}</Badge></TD>
                    <TD className="whitespace-nowrap text-xs text-muted-foreground" title={formatDateTime(e.startedAt)}>{formatRelative(e.startedAt)}</TD>
                    <TD className="text-right tabular-nums text-xs">{formatDuration(e.durationMs)}</TD>
                    <TD className="max-w-xs truncate text-xs text-muted-foreground">{e.errorMessage ?? ""}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {execs.nextCursor && (
              <div className="border-t p-3 text-center">
                <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/workflows/${id}?${new URLSearchParams({ ...(filter ? { status: filter } : {}), cursor: execs.nextCursor })}`}>Older executions</Link>
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Recovery policy</CardTitle></CardHeader>
            <CardContent><WorkflowSettingsForm workflow={w} disabled={!can(auth.role, "workflow:manage")} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent incidents</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {incidents.items.length === 0 && <p className="text-xs text-muted-foreground">No incidents for this workflow.</p>}
              {incidents.items.map((i) => (
                <Link key={i.id} href={`/incidents/${i.id}`} className="block rounded-md border p-2 hover:bg-muted">
                  <div className="flex items-center gap-2 text-xs"><span className="font-mono">{incidentRef(i.number)}</span><StatusBadge status={i.status} /><SeverityBadge severity={i.severity} /></div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{i.errorMessage}</div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
