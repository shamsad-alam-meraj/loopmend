import { CheckCircle2, CircleSlash, Clock, ShieldCheck } from "lucide-react";
import type { PolicyDecision } from "@/lib/recovery/policy";
import { STRATEGY_INFO } from "@/lib/recovery/policy";
import type { getRecoveryPlan } from "@/services/recovery.service";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/utils/format";
import { PlanStatusBadge, RiskBadge } from "./badges";
import { DecisionForm, ExecuteForm } from "./plan-controls";

type Detail = Awaited<ReturnType<typeof getRecoveryPlan>>;

export function PlanCard({ detail, canApprove, canExecute, currentUserId }: { detail: Detail; canApprove: boolean; canExecute: boolean; currentUserId: string }) {
  const { plan, attempts, approvals } = detail;
  const policy = plan.policy as unknown as PolicyDecision;
  const backoffActive = plan.nextAttemptAt && plan.nextAttemptAt > new Date();
  const selfApprovalBlocked = policy.requiresSeparateApprover && plan.createdBy === currentUserId;
  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="recovery-plan">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{STRATEGY_INFO[plan.strategy].label}</span>
        <PlanStatusBadge status={plan.status} />
        <RiskBadge risk={plan.riskLevel} />
        {!plan.requiresApproval && <Badge tone="info">auto-approved by policy</Badge>}
        <span className="text-xs text-muted-foreground">attempts {plan.attemptsUsed}/{plan.maxAttempts} · deadline {formatRelative(plan.deadlineAt)}</span>
      </div>
      {plan.rationale && <p className="text-xs text-muted-foreground">{plan.rationale}</p>}

      <details className="text-xs" open={plan.status === "pending_approval"}>
        <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground"><ShieldCheck className="size-3.5" /> Policy evaluation</summary>
        <ul className="mt-2 space-y-1">
          {policy.checks.map((c) => (
            <li key={c.name} className="flex gap-1.5">{c.passed ? <CheckCircle2 className="mt-0.5 size-3 text-success" /> : <CircleSlash className="mt-0.5 size-3 text-destructive" />}<span><code>{c.name}</code> — {c.detail}</span></li>
          ))}
          {policy.reasons.map((r, i) => <li key={i} className="text-muted-foreground">• {r}</li>)}
          <li className="text-muted-foreground">• Approver: {policy.approverMinRole}+{policy.requiresSeparateApprover ? " (must differ from requester)" : ""}</li>
        </ul>
      </details>

      {approvals.map(({ approval, email, fullName }) => (
        <p key={approval.id} className="text-xs text-muted-foreground">
          {approval.decision === "approved" ? "✓ Approved" : "✗ Rejected"} by {fullName ?? email} {formatRelative(approval.createdAt)}{approval.comment ? ` — “${approval.comment}”` : ""}
        </p>
      ))}
      {plan.deadLetterReason && <p className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">Dead letter: {plan.deadLetterReason}</p>}

      {attempts.length > 0 && (
        <ol className="space-y-1 text-xs">
          {attempts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={a.status === "succeeded" ? "success" : a.status === "failed" ? "danger" : "primary"}>#{a.attemptNumber} {a.status}</Badge>
              <span className="text-muted-foreground">{String((a.result as { message?: string }).message ?? a.error ?? "")}</span>
              <span className="text-muted-foreground">· {formatDuration(a.durationMs)} · <code title={a.idempotencyKey}>key …{a.idempotencyKey.slice(-12)}</code></span>
            </li>
          ))}
        </ol>
      )}
      {backoffActive && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3" /> Backoff: next attempt not before {formatDateTime(plan.nextAttemptAt)}</p>}

      {plan.status === "pending_approval" && canApprove && !selfApprovalBlocked && <DecisionForm planId={plan.id} incidentId={plan.incidentId} />}
      {plan.status === "pending_approval" && selfApprovalBlocked && <p className="text-xs text-muted-foreground">Four-eyes rule: another {policy.approverMinRole} must approve this high-risk plan.</p>}
      {plan.status === "approved" && canExecute && !backoffActive && <ExecuteForm planId={plan.id} incidentId={plan.incidentId} label={plan.attemptsUsed ? "Run next attempt" : "Execute"} />}
    </div>
  );
}
