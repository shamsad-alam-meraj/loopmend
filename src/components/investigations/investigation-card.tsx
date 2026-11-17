import { Info } from "lucide-react";
import type { Investigation } from "@/lib/ai/schemas/investigation.schema";
import { Badge } from "@/components/ui/badge";
import { CategoryBadge, SeverityBadge } from "@/components/incidents/badges";
import { formatDuration, formatRelative, titleCase } from "@/lib/utils/format";

type Row = {
  id: string;
  status: string;
  provider: string;
  model: string;
  promptVersion: string;
  diagnosis: Record<string, unknown> | null;
  confidence: number | null;
  usedFallback: boolean;
  error: string | null;
  latencyMs: number | null;
  createdAt: Date;
};

export function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2" title="Model-reported estimate — not a calibrated probability">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

export function InvestigationCard({ inv }: { inv: Row }) {
  if (inv.status !== "completed" || !inv.diagnosis) {
    return (
      <div className="rounded-md border p-3 text-xs text-muted-foreground">
        Investigation {inv.status}{inv.error ? `: ${inv.error}` : ""} · {formatRelative(inv.createdAt)}
      </div>
    );
  }
  const d = inv.diagnosis as unknown as Investigation;
  return (
    <div className="space-y-4" data-testid="investigation-result">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={inv.provider === "rules" ? "neutral" : "primary"}>{inv.provider === "rules" ? "Rules engine" : `${titleCase(inv.provider)} · ${inv.model}`}</Badge>
        {inv.usedFallback && <Badge tone="warning" title={inv.error ?? undefined}>AI unavailable → fallback</Badge>}
        <CategoryBadge category={d.category} />
        <SeverityBadge severity={d.severity} />
        <span className="text-muted-foreground">{formatRelative(inv.createdAt)} · {formatDuration(inv.latencyMs)} · {inv.promptVersion}</span>
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground">Probable root cause</div>
        <p className="mt-1 text-sm font-medium">{d.rootCause.summary}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {d.rootCause.evidence.map((e, idx) => <li key={idx}>{e}</li>)}
        </ul>
      </div>
      <div className="grid gap-3 rounded-md border bg-muted/40 p-3 sm:grid-cols-3">
        <div>
          <div className="text-[11px] text-muted-foreground">Recommended strategy</div>
          <div className="text-sm font-medium">{titleCase(d.recommendation.strategy)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Max attempts</div>
          <div className="text-sm font-medium tabular-nums">{d.recommendation.maxAttempts}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Confidence</div>
          <ConfidenceMeter value={d.confidence} />
        </div>
        {d.recommendation.rationale && <p className="text-xs text-muted-foreground sm:col-span-3">{d.recommendation.rationale}</p>}
      </div>
      {d.caveats && d.caveats.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {d.caveats.map((c, idx) => <li key={idx} className="flex gap-1.5"><Info className="mt-0.5 size-3 shrink-0" />{c}</li>)}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        AI output is advisory. Recovery runs only allowlisted strategies through deterministic policy checks, with human approval where required.
      </p>
    </div>
  );
}
