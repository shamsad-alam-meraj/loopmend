import type { Metadata } from "next";
import Link from "next/link";
import { BrainCircuit } from "lucide-react";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { listInvestigations } from "@/services/investigation.service";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { CategoryBadge, incidentRef } from "@/components/incidents/badges";
import { ConfidenceMeter } from "@/components/investigations/investigation-card";
import { formatDuration, formatRelative, titleCase } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Investigations" };

export default async function InvestigationsPage() {
  const auth = await requirePageAuth("incident:read");
  const rows = await listInvestigations(toServiceContext(auth), { limit: 100 });
  const ai = process.env.GEMINI_API_KEY ? `Gemini (${process.env.GEMINI_MODEL || "gemini-2.5-flash"})` : "Rules engine (no GEMINI_API_KEY configured)";
  return (
    <>
      <PageHeader title="Investigations" description={`Root-cause analyses with model, prompt version and evidence. Active engine: ${ai}.`} />
      <Card>
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={<BrainCircuit />} title="No investigations yet" description="Open an incident and run an investigation." /></div>
        ) : (
          <Table>
            <THead><TR><TH>Incident</TH><TH>Root cause</TH><TH>Category</TH><TH>Strategy</TH><TH>Confidence</TH><TH>Engine</TH><TH>When</TH></TR></THead>
            <TBody>
              {rows.map(({ investigation: inv, incidentNumber, workflowName }) => {
                const strategy = (inv.diagnosis as { recommendation?: { strategy?: string } } | null)?.recommendation?.strategy;
                return (
                  <TR key={inv.id}>
                    <TD><Link href={`/incidents/${inv.incidentId}`} className="hover:text-primary"><span className="font-mono text-xs text-muted-foreground">{incidentRef(incidentNumber)}</span> <span className="font-medium">{workflowName}</span></Link></TD>
                    <TD className="max-w-xs truncate text-xs">{inv.rootCauseSummary ?? inv.error ?? inv.status}</TD>
                    <TD>{inv.category && <CategoryBadge category={inv.category} />}</TD>
                    <TD className="text-xs">{strategy ? titleCase(strategy) : "—"}</TD>
                    <TD>{inv.confidence !== null ? <ConfidenceMeter value={inv.confidence} /> : "—"}</TD>
                    <TD className="text-xs">
                      <div className="flex items-center gap-1">{inv.provider}{inv.usedFallback && <Badge tone="warning">fallback</Badge>}</div>
                      <div className="text-muted-foreground">{formatDuration(inv.latencyMs)}</div>
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(inv.createdAt)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
