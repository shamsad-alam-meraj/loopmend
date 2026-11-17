import type { Metadata } from "next";
import Link from "next/link";
import { Siren } from "lucide-react";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { incidentListQuery } from "@/lib/validation/query.schema";
import { getIncidentCounts, listIncidents } from "@/services/incident.service";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { CategoryBadge, incidentRef, SeverityBadge, StatusBadge } from "@/components/incidents/badges";
import { formatRelative } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Incidents" };

const VIEWS = [
  { key: "active", label: "Active" },
  { key: "closed", label: "Closed" },
  { key: "dead_letter", label: "Dead letter" },
  { key: "all", label: "All" },
] as const;

export default async function IncidentsPage({ searchParams }: PageProps<"/incidents">) {
  const auth = await requirePageAuth("incident:read");
  const ctx = toServiceContext(auth);
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = incidentListQuery.safeParse(raw);
  const query = parsed.success ? parsed.data : incidentListQuery.parse({});
  const view = query.view ?? "active";
  const [{ items, nextCursor }, counts] = await Promise.all([listIncidents(ctx, { ...query, view }), getIncidentCounts(ctx)]);

  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view, q: query.q, severity: query.severity.join(",") || undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/incidents?${p.toString()}`;
  };
  const viewCount = (k: string) =>
    k === "active" ? counts.active : k === "dead_letter" ? (counts.byStatus.dead_letter ?? 0) : k === "closed" ? (counts.byStatus.resolved ?? 0) + (counts.byStatus.dismissed ?? 0) + (counts.byStatus.dead_letter ?? 0) : undefined;

  return (
    <>
      <PageHeader title="Incidents" description="Failures ingested from n8n, correlated by workflow and error signature." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border bg-card p-1">
          {VIEWS.map((v) => (
            <Link key={v.key} href={href({ view: v.key, cursor: undefined })} className={cn("rounded-md px-3 py-1 text-xs font-medium", view === v.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
              {v.label}
              {viewCount(v.key) !== undefined && <span className="ml-1.5 tabular-nums opacity-70">{viewCount(v.key)}</span>}
            </Link>
          ))}
        </div>
        <form className="flex flex-wrap gap-2" action="/incidents">
          <input type="hidden" name="view" value={view} />
          <Input name="q" defaultValue={query.q} placeholder="Search title, error or INC-12" className="h-8 w-60 text-xs" />
          <Select name="severity" defaultValue={query.severity[0] ?? ""} className="h-8 w-32 text-xs" aria-label="Severity">
            <option value="">Any severity</option>
            {["critical", "high", "medium", "low"].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Button size="sm" variant="outline" type="submit">Filter</Button>
        </form>
      </div>

      <Card>
        {items.length === 0 ? (
          <div className="p-6"><EmptyState icon={<Siren />} title="No incidents here" description="Nothing matches this view. Failures from n8n will appear automatically." /></div>
        ) : (
          <Table data-testid="incident-table">
            <THead>
              <TR><TH>Incident</TH><TH>Severity</TH><TH>Status</TH><TH>Category</TH><TH className="text-right">Occurrences</TH><TH>Last seen</TH></TR>
            </THead>
            <TBody>
              {items.map((i) => (
                <TR key={i.id}>
                  <TD className="max-w-md">
                    <Link href={`/incidents/${i.id}`} className="group block">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{incidentRef(i.number)}</span>
                        <span className="truncate font-medium group-hover:text-primary">{i.workflowName}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{i.errorMessage}</div>
                    </Link>
                  </TD>
                  <TD><SeverityBadge severity={i.severity} /></TD>
                  <TD><StatusBadge status={i.status} /></TD>
                  <TD><CategoryBadge category={i.category} /></TD>
                  <TD className="text-right tabular-nums">{i.occurrenceCount}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(i.lastSeenAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {nextCursor && (
        <div className="mt-4 text-center">
          <Link href={href({ cursor: nextCursor })} className={buttonVariants({ variant: "outline", size: "sm" })}>Older incidents</Link>
        </div>
      )}
    </>
  );
}
