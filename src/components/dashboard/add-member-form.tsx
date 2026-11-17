"use client";

import { useActionState } from "react";
import { addMemberAction } from "@/actions/organization.actions";
import type { FormState } from "@/actions/auth.actions";
import { Input, Select } from "@/components/ui/input";
import { FormAlert, SubmitButton } from "@/components/auth/form-bits";

export function AddMemberForm({ roles }: { roles: string[] }) {
  const [state, action] = useActionState<FormState, FormData>(addMemberAction, {});
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Input name="email" type="email" placeholder="teammate@company.com" required className="min-w-56 flex-1" />
        <Select name="role" defaultValue="viewer" className="w-32">
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <SubmitButton pendingText="Adding…">Add member</SubmitButton>
      </div>
      <FormAlert error={state.error} message={state.message} />
    </form>
  );
}
