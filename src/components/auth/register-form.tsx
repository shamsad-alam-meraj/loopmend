"use client";

import { useActionState } from "react";
import { registerAction, type FormState } from "@/actions/auth.actions";
import { Field, FormAlert, SubmitButton } from "./form-bits";

export function RegisterForm() {
  const [state, action] = useActionState<FormState, FormData>(registerAction, {});
  return (
    <form action={action} className="space-y-4">
      <FormAlert error={state.error} message={state.message} />
      <Field label="Full name" name="fullName" autoComplete="name" required error={state.fieldErrors?.fullName} />
      <Field label="Work email" name="email" type="email" autoComplete="email" required error={state.fieldErrors?.email} />
      <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={10} required error={state.fieldErrors?.password} />
      <Field label="Organization name" name="organization" placeholder="Acme Inc." required error={state.fieldErrors?.organization} />
      <SubmitButton className="w-full" pendingText="Creating workspace…">Create account</SubmitButton>
    </form>
  );
}
