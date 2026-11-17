"use client";

import { useActionState } from "react";
import { Check, Play, X } from "lucide-react";
import { decidePlanAction, executePlanAction, proposePlanAction } from "@/actions/recovery.actions";
import type { ActionResult } from "@/actions/incident.actions";
import { FormAlert, SubmitButton } from "@/components/auth/form-bits";
import { Input, Select } from "@/components/ui/input";

export function DecisionForm({ planId, incidentId }: { planId: string; incidentId: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(decidePlanAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="incidentId" value={incidentId} />
      <div className="flex flex-wrap gap-2">
        <Input name="comment" placeholder="Comment (recorded in audit log)" className="h-8 min-w-48 flex-1 text-xs" maxLength={1000} />
        <SubmitButton name="decision" value="approved" size="sm" variant="success" pendingText="Approving…"><Check /> Approve</SubmitButton>
        <SubmitButton name="decision" value="rejected" size="sm" variant="outline" pendingText="Rejecting…"><X /> Reject</SubmitButton>
      </div>
      <FormAlert error={state.error} message={state.message} />
    </form>
  );
}

export function ExecuteForm({ planId, incidentId, label = "Execute attempt" }: { planId: string; incidentId: string; label?: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(executePlanAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="incidentId" value={incidentId} />
      <SubmitButton size="sm" pendingText="Executing…"><Play /> {label}</SubmitButton>
      <FormAlert error={state.error} message={state.message} />
    </form>
  );
}

export function ProposeForm({ incidentId, recommended }: { incidentId: string; recommended?: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(proposePlanAction, {});
  const strategies = ["exponential_backoff", "retry_execution", "refresh_credentials_then_retry", "pause_workflow", "notify_owner", "manual_review"];
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="incidentId" value={incidentId} />
      <div className="flex flex-wrap gap-2">
        <Select name="strategy" defaultValue={recommended ?? ""} className="h-8 w-64 text-xs" aria-label="Strategy">
          <option value="">Use investigation recommendation</option>
          {strategies.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}{s === recommended ? " (recommended)" : ""}</option>)}
        </Select>
        <SubmitButton size="sm" variant="outline" pendingText="Evaluating policy…">Propose recovery plan</SubmitButton>
      </div>
      <FormAlert error={state.error} message={state.message} />
    </form>
  );
}
