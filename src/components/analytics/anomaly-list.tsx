import Link from "next/link";
import { Activity, Hourglass, TrendingUp } from "lucide-react";
import type { Anomaly } from "@/lib/analytics/anomaly";
import { Badge } from "@/components/ui/badge";

const ICON = { failure_spike: TrendingUp, latency_regression: Hourglass, silence: Activity };

export function AnomalyList({ items }: { items: { workflowId: string; workflowName: string; anomalies: Anomaly[] }[] }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">No anomalies: all workflows are within their 7-day baseline.</p>;
  return (
    <ul className="space-y-2">
      {items.flatMap((w) =>
        w.anomalies.map((a) => {
          const Icon = ICON[a.kind];
          return (
            <li key={`${w.workflowId}-${a.kind}`} className="flex gap-3 rounded-md border p-2.5">
              <Icon className={a.severity === "critical" ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-warning"} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/workflows/${w.workflowId}`} className="font-medium hover:text-primary">{w.workflowName}</Link>
                  <Badge tone={a.severity === "critical" ? "danger" : "warning"}>{a.kind.replace("_", " ")}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{a.message}</p>
              </div>
            </li>
          );
        }),
      )}
    </ul>
  );
}
