"use client";

import { useActionState } from "react";
import { updateIncidentAction, type ActionResult } from "@/actions/incident.actions";
import { SubmitButton, FormAlert } from "@/components/auth/form-bits";
import { Select, Textarea } from "@/components/ui/input";

type Props = {
  incidentId: string;
  status: string;
  severity: string;
  acknowledged: boolean;
  assignedToMe: boolean;
};

export function IncidentActions({ incidentId, status, severity, acknowledged, assignedToMe }: Props) {
  const [state, action] = useActionState<ActionResult, FormData>(updateIncidentAction, {});
  const closed = ["resolved", "dismissed"].includes(status);
  const btn = (value: string, label: string, variant: "outline" | "default" | "success" | "ghost" = "outline") => (
    <SubmitButton key={value} name="action" value={value} size="sm" variant={variant}>{label}</SubmitButton>
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="incidentId" value={incidentId} />
      <div className="flex flex-wrap gap-2">
        {!acknowledged && !closed && btn("acknowledge", "Acknowledge", "default")}
        {!closed && (assignedToMe ? btn("unassign", "Unassign me", "ghost") : btn("assign_self", "Assign to me"))}
        {!closed && btn("resolve", "Resolve", "success")}
        {!closed && btn("dismiss", "Dismiss", "ghost")}
        {(closed || status === "dead_letter") && btn("reopen", "Reopen")}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <Select name="severity" defaultValue={severity} className="h-8 w-32 text-xs" aria-label="Severity">
          {["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Textarea name="note" placeholder="Add a note (optional)" className="min-h-8 min-w-48 flex-1 text-xs" rows={1} maxLength={1000} />
        <SubmitButton size="sm" variant="outline">Save</SubmitButton>
      </div>
      <FormAlert error={state.error} />
    </form>
  );
}
