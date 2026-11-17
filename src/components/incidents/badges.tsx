import type { Category, IncidentStatus, Severity } from "@schema";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { titleCase } from "@/lib/utils/format";

const SEVERITY_TONE: Record<Severity, BadgeProps["tone"]> = { low: "neutral", medium: "info", high: "warning", critical: "danger" };
const STATUS_TONE: Record<IncidentStatus, BadgeProps["tone"]> = {
  open: "danger",
  investigating: "info",
  awaiting_approval: "warning",
  recovering: "primary",
  resolved: "success",
  dismissed: "neutral",
  dead_letter: "danger",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} className="capitalize">
      <span className="size-1.5 rounded-full bg-current" />
      {severity}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: IncidentStatus | string }) {
  return <Badge tone={STATUS_TONE[status as IncidentStatus] ?? "neutral"}>{titleCase(status)}</Badge>;
}

export function CategoryBadge({ category }: { category: Category | string }) {
  return <Badge tone="neutral">{titleCase(category)}</Badge>;
}

export function HealthBadge({ health }: { health: "healthy" | "degraded" | "failing" | "idle" }) {
  const tone = { healthy: "success", degraded: "warning", failing: "danger", idle: "neutral" } as const;
  return <Badge tone={tone[health]} className="capitalize">{health}</Badge>;
}

export const incidentRef = (n: number) => `INC-${String(n).padStart(4, "0")}`;
