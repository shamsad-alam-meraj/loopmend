"use client";

import { useActionState } from "react";
import { BrainCircuit } from "lucide-react";
import { investigateAction } from "@/actions/investigation.actions";
import type { ActionResult } from "@/actions/incident.actions";
import { FormAlert, SubmitButton } from "@/components/auth/form-bits";

export function InvestigateButton({ incidentId, label = "Run investigation" }: { incidentId: string; label?: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(investigateAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="incidentId" value={incidentId} />
      <SubmitButton size="sm" pendingText="Analyzing evidence…"><BrainCircuit /> {label}</SubmitButton>
      <FormAlert error={state.error} message={state.message} />
    </form>
  );
}
