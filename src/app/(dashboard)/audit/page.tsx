import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { can } from "@/lib/security/rbac";
import { listAuditLogs } from "@/services/audit.service";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const auth = await requirePageAuth();
  if (!can(auth.role, "audit:read")) {
    return (<><PageHeader title="Audit log" /><EmptyState icon={<ScrollText />} title="Operators and above can view the audit log" /></>);
  }
  const before = (await searchParams).before;
  const rows = await listAuditLogs(toServiceContext(auth), { limit: 50, before: typeof before === "string" && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined });
  const last = rows.at(-1);
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of approvals, recoveries, configuration and membership changes. Updates and deletes are blocked by a database trigger." />
      <Card>
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={<ScrollText />} title="No audit events yet" /></div>
        ) : (
          <Table>
            <THead><TR><TH>Time (UTC)</TH><TH>Actor</TH><TH>Action</TH><TH>Target</TH><TH>Details</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap font-mono text-xs">{formatDateTime(r.createdAt)}</TD>
                  <TD><Badge tone={r.actorType === "user" ? "primary" : r.actorType === "ai" ? "info" : "neutral"}>{r.actorType}</Badge></TD>
                  <TD className="font-mono text-xs">{r.action}</TD>
                  <TD className="text-xs">
                    {r.targetType === "incident" && r.targetId ? <Link className="text-primary hover:underline" href={`/incidents/${r.targetId}`}>incident</Link> : r.targetType ?? "—"}
                  </TD>
                  <TD className="max-w-md"><code className="line-clamp-2 break-all text-[11px] text-muted-foreground">{JSON.stringify(r.metadata)}</code></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {last && rows.length === 50 && (
        <div className="mt-4 text-center"><Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/audit?before=${encodeURIComponent(last.createdAt.toISOString())}`}>Older events</Link></div>
      )}
    </>
  );
}
