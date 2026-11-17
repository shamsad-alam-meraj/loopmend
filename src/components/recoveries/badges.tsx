import type { RecoveryStatus, RiskLevel } from "@schema";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { titleCase } from "@/lib/utils/format";

const TONE: Record<RecoveryStatus, BadgeProps["tone"]> = {
  pending_approval: "warning",
  approved: "info",
  executing: "primary",
  succeeded: "success",
  failed: "danger",
  rejected: "neutral",
  dead_letter: "danger",
  cancelled: "neutral",
};
export function PlanStatusBadge({ status }: { status: RecoveryStatus }) {
  return <Badge tone={TONE[status]}>{titleCase(status)}</Badge>;
}
export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <Badge tone={risk === "high" ? "danger" : risk === "medium" ? "warning" : "success"}>{risk} risk</Badge>;
}
