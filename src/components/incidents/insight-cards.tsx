import { BookOpenCheck, FileDown, Gauge } from "lucide-react";
import { toServiceContext, type AuthContext } from "@/lib/auth";
import { incidentImpact } from "@/services/insights.service";
import { RUNBOOKS } from "@/lib/incidents/runbooks";
import type { Category } from "@schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { formatDuration, formatPercent } from "@/lib/utils/format";

export async function ImpactCard({ auth, incidentId }: { auth: AuthContext; incidentId: string }) {
  const impact = await incidentImpact(toServiceContext(auth), incidentId);
  const items: [string, string][] = [
    ["Failed runs", `${impact.failures} / ${impact.runs}`],
    ["Failure rate", formatPercent(impact.failureRate)],
    ["Open for", formatDuration(impact.openMs)],
    ["Recurrence", impact.occurrencesPerHour ? `${impact.occurrencesPerHour.toFixed(1)}/h` : "—"],
  ];
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Gauge className="size-4 text-primary" /> Impact</CardTitle>
        <a href={`/api/v1/incidents/${incidentId}/postmortem`} className={buttonVariants({ size: "sm", variant: "outline" })} download>
          <FileDown /> Postmortem
        </a>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-md border bg-muted/40 p-2.5">
            <div className="text-[11px] text-muted-foreground">{k}</div>
            <div className="text-sm font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function RunbookCard({ category }: { category: Category }) {
  const rb = RUNBOOKS[category];
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><BookOpenCheck className="size-4 text-primary" /> Runbook · {rb.title}</CardTitle></CardHeader>
      <CardContent>
        <ol className="space-y-2 text-xs">
          {rb.steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{i + 1}</span>
              <span className="text-muted-foreground">{s}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
