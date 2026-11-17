"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FlaskConical } from "lucide-react";
import { simulateFailureAction, type SimulationState } from "@/actions/integration.actions";
import { FormAlert, SubmitButton } from "@/components/auth/form-bits";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const SCENARIO_OPTIONS = [
  ["rate_limit", "Rate limited (429)"],
  ["auth_expired", "Expired credential (401)"],
  ["timeout", "Timeout"],
  ["upstream_503", "Upstream outage (503)"],
  ["validation", "Invalid input data"],
] as const;

export function SimulateFailure({ workflows }: { workflows: { id: string; name: string }[] }) {
  const [state, action] = useActionState<SimulationState, FormData>(simulateFailureAction, {});
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select name="workflowId" className="w-56" aria-label="Workflow" required>
          {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Select name="scenario" className="w-52" aria-label="Failure scenario">
          {SCENARIO_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" name="deliverTwice" defaultChecked className="accent-[var(--primary)]" /> Re-deliver to prove idempotency
        </label>
        <SubmitButton size="sm" variant="outline" pendingText="Sending signed event…"><FlaskConical /> Simulate failure</SubmitButton>
      </div>
      <FormAlert error={state.error} />
      {state.result && (
        <ul className="space-y-1 text-xs" data-testid="simulation-result">
          {state.result.map((r) => (
            <li key={r.label} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{r.label}:</span>
              <Badge tone={r.status < 300 ? "success" : "danger"}>HTTP {r.status}</Badge>
              {r.outcome && <Badge tone={r.duplicate ? "warning" : "info"}>{r.outcome}</Badge>}
              {r.incidentId && <Link className="text-primary hover:underline" href={`/incidents/${r.incidentId}`}>INC-{r.incidentNumber}</Link>}
              {r.message && <span className="text-destructive">{r.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
