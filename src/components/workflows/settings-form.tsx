"use client";

import { useActionState } from "react";
import { updateWorkflowAction } from "@/actions/workflow.actions";
import type { ActionResult } from "@/actions/incident.actions";
import { FormAlert, SubmitButton } from "@/components/auth/form-bits";
import { Label, Select } from "@/components/ui/input";

const PROFILES: [string, string][] = [
  ["read_only", "Read only — no external writes"],
  ["idempotent", "Idempotent — safe to re-run"],
  ["non_idempotent", "Non-idempotent — may duplicate side effects"],
  ["financial", "Financial — moves money / charges"],
  ["destructive", "Destructive — deletes or overwrites data"],
];

export function WorkflowSettingsForm({ workflow, disabled }: { workflow: { id: string; criticality: string; sideEffectProfile: string; autoRecoveryEnabled: boolean }; disabled: boolean }) {
  const [state, action] = useActionState<ActionResult, FormData>(updateWorkflowAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="workflowId" value={workflow.id} />
      <fieldset disabled={disabled} className="space-y-3 disabled:opacity-70">
        <div className="space-y-1.5">
          <Label htmlFor="criticality">Criticality</Label>
          <Select id="criticality" name="criticality" defaultValue={workflow.criticality}>
            {["low", "medium", "high", "critical"].map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sideEffectProfile">Side-effect profile</Label>
          <Select id="sideEffectProfile" name="sideEffectProfile" defaultValue={workflow.sideEffectProfile}>
            {PROFILES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <p className="text-[11px] text-muted-foreground">Drives recovery policy. Financial and destructive workflows are never retried automatically.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="autoRecoveryEnabled" defaultChecked={workflow.autoRecoveryEnabled} className="accent-[var(--primary)]" />
          Allow low-risk recovery without approval
        </label>
        {!disabled && <SubmitButton size="sm" pendingText="Saving…">Save settings</SubmitButton>}
      </fieldset>
      {disabled && <p className="text-[11px] text-muted-foreground">Only admins can change workflow policy.</p>}
      <FormAlert error={state.error} message={state.message} />
    </form>
  );
}
