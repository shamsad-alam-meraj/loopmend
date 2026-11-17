"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "@/actions/auth.actions";
import { Field, FormAlert, SubmitButton } from "./form-bits";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/overview"} />
      <FormAlert error={state.error} />
      <Field label="Email" name="email" type="email" autoComplete="email" required error={state.fieldErrors?.email} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required error={state.fieldErrors?.password} />
      <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
