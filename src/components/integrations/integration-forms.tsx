"use client";

import { useActionState } from "react";
import { createIntegrationAction, rotateSecretAction, testIntegrationAction, type IntegrationFormState } from "@/actions/integration.actions";
import { FormAlert, SubmitButton } from "@/components/auth/form-bits";
import { Input, Label } from "@/components/ui/input";
import { SecretReveal } from "./secret-reveal";

export function CreateIntegrationForm({ webhookUrl }: { webhookUrl: string }) {
  const [state, action] = useActionState<IntegrationFormState, FormData>(createIntegrationAction, {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="int-name">Name</Label><Input id="int-name" name="name" placeholder="Production n8n" required /></div>
        <div className="space-y-1.5"><Label htmlFor="int-url">n8n base URL (optional)</Label><Input id="int-url" name="baseUrl" placeholder="https://n8n.example.com" /></div>
        <div className="space-y-1.5"><Label htmlFor="int-key">n8n API key (optional, encrypted)</Label><Input id="int-key" name="apiKey" type="password" autoComplete="off" /></div>
      </div>
      <SubmitButton size="sm" pendingText="Connecting…">Connect n8n</SubmitButton>
      <FormAlert error={state.error} message={state.message} />
      {state.secret && <SecretReveal {...state.secret} webhookUrl={webhookUrl} />}
    </form>
  );
}

export function IntegrationRowActions({ integrationId, webhookUrl }: { integrationId: string; webhookUrl: string }) {
  const [rotateState, rotate] = useActionState<IntegrationFormState, FormData>(rotateSecretAction, {});
  const [testState, test] = useActionState<IntegrationFormState, FormData>(testIntegrationAction, {});
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-2">
        <form action={test}><input type="hidden" name="integrationId" value={integrationId} /><SubmitButton size="sm" variant="outline" pendingText="Testing…">Test API</SubmitButton></form>
        <form action={rotate}><input type="hidden" name="integrationId" value={integrationId} /><SubmitButton size="sm" variant="outline" pendingText="Rotating…">Rotate secret</SubmitButton></form>
      </div>
      <FormAlert error={testState.error ?? rotateState.error} message={testState.message ?? rotateState.message} />
      {rotateState.secret && <SecretReveal {...rotateState.secret} webhookUrl={webhookUrl} />}
    </div>
  );
}
