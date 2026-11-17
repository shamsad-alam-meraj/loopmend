"use client";

import { useActionState } from "react";
import { createOrganizationAction, type FormState } from "@/actions/auth.actions";
import { Field, FormAlert, SubmitButton } from "./form-bits";

export function CreateOrgForm() {
  const [state, action] = useActionState<FormState, FormData>(createOrganizationAction, {});
  return (
    <form action={action} className="space-y-4">
      <FormAlert error={state.error} />
      <Field label="Organization name" name="name" placeholder="Acme Inc." required minLength={2} maxLength={80} />
      <SubmitButton className="w-full" pendingText="Creating…">Create organization</SubmitButton>
    </form>
  );
}
