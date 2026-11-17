import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { getIncident } from "@/services/incident.service";
import { can } from "@/lib/security/rbac";
import { isAppError } from "@/lib/utils/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CategoryBadge, incidentRef, SeverityBadge, StatusBadge } from "@/components/incidents/badges";
import { IncidentActions } from "@/components/incidents/incident-actions";
import { Timeline } from "@/components/incidents/timeline";
import { IncidentExtraSections } from "@/components/incidents/extra-sections";
import { formatDateTime, formatDuration, formatRelative, titleCase } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Incident" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export default async function IncidentPage({ params }: PageProps<"/incidents/[id]">) {
  const auth = await requirePageAuth("incident:read");
  const ctx = toServiceContext(auth);
  const { id } = await params;
  const data = await getIncident(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { incident: i, workflow: w, execution: e, assignee } = data;

  return (
    <>
      <Link href="/incidents" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" /> Incidents</Link>
      <div className="mb-6 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{incidentRef(i.number)}</span>
          <StatusBadge status={i.status} />
          <SeverityBadge severity={i.severity} />
          <CategoryBadge category={i.category} />
          {i.occurrenceCount > 1 && <Badge tone="warning">×{i.occurrenceCount} occurrences</Badge>}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{i.title}</h1>
        <p className="text-xs text-muted-foreground">
          First seen {formatRelative(i.firstSeenAt)} · last seen {formatRelative(i.lastSeenAt)}
          {i.acknowledgedAt ? ` · acknowledged ${formatRelative(i.acknowledgedAt)}` : " · not acknowledged"}
          {assignee?.email ? ` · assigned to ${assignee.fullName ?? assignee.email}` : ""}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {can(auth.role, "incident:update") && (
            <Card>
              <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
              <CardContent>
                <IncidentActions incidentId={i.id} status={i.status} severity={i.severity} acknowledged={Boolean(i.acknowledgedAt)} assignedToMe={i.assigneeId === auth.user.id} />
              </CardContent>
            </Card>
          )}
          <IncidentExtraSections auth={auth} incidentId={i.id} incidentStatus={i.status} />
          <Card>
            <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
            <CardContent><Timeline events={data.events} /></CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Failure</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Error code"><code className="font-mono text-xs">{i.errorCode ?? "—"}</code></Row>
                <Row label="Message"><span className="font-mono text-xs">{i.errorMessage}</span></Row>
                <Row label="Failed node">{e?.errorNode ?? "—"}</Row>
                <Row label="HTTP status">{e?.httpStatus ?? "—"}</Row>
                <Row label="Fingerprint"><code className="font-mono text-[11px] text-muted-foreground">{i.fingerprint.slice(0, 16)}…</code></Row>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Workflow</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Name"><Link href={`/workflows/${w.id}`} className="text-primary hover:underline">{w.name}</Link></Row>
                <Row label="Criticality"><span className="capitalize">{w.criticality}</span></Row>
                <Row label="Side effects">{titleCase(w.sideEffectProfile)}</Row>
                <Row label="Auto-recovery">{w.autoRecoveryEnabled ? "Enabled (low risk only)" : "Disabled"}</Row>
              </dl>
            </CardContent>
          </Card>
          {e && (
            <Card>
              <CardHeader><CardTitle>Latest execution</CardTitle></CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Row label="Execution"><code className="font-mono text-xs">{e.externalId}</code></Row>
                  <Row label="Started">{formatDateTime(e.startedAt)}</Row>
                  <Row label="Duration">{formatDuration(e.durationMs)}</Row>
                  <Row label="Mode">{e.mode ?? "—"}</Row>
                </dl>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
