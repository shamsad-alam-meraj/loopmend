"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { createIntegration, deleteIntegration, rotateWebhookSecret, testIntegration } from "@/services/integration.service";
import { SCENARIOS, simulateFailure, type Scenario } from "@/services/simulator.service";
import { isAppError } from "@/lib/utils/errors";

export type IntegrationFormState = { error?: string; message?: string; secret?: { integrationId: string; webhookSecret: string } };

const handle = (e: unknown): IntegrationFormState => {
  if (isAppError(e)) return { error: e.message };
  throw e;
};

export async function createIntegrationAction(_prev: IntegrationFormState, formData: FormData): Promise<IntegrationFormState> {
  const auth = await requirePageAuth("integration:manage");
  const input = z
    .object({ name: z.string().min(2).max(60), baseUrl: z.string().max(300).optional(), apiKey: z.string().max(500).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: "Name must be 2–60 characters" };
  try {
    const { integration, webhookSecret } = await createIntegration(toServiceContext(auth), {
      name: input.data.name,
      baseUrl: input.data.baseUrl || null,
      apiKey: input.data.apiKey || null,
    });
    revalidatePath("/settings");
    return { message: "Integration created. Copy the secret now — it will not be shown again.", secret: { integrationId: integration.id, webhookSecret } };
  } catch (e) {
    return handle(e);
  }
}

export async function rotateSecretAction(_prev: IntegrationFormState, formData: FormData): Promise<IntegrationFormState> {
  const auth = await requirePageAuth("integration:manage");
  const id = z.uuid().parse(formData.get("integrationId"));
  try {
    const { webhookSecret } = await rotateWebhookSecret(toServiceContext(auth), id);
    return { message: "Secret rotated. Update your n8n credential — the old secret no longer works.", secret: { integrationId: id, webhookSecret } };
  } catch (e) {
    return handle(e);
  }
}

export async function testIntegrationAction(_prev: IntegrationFormState, formData: FormData): Promise<IntegrationFormState> {
  const auth = await requirePageAuth("integration:manage");
  const id = z.uuid().parse(formData.get("integrationId"));
  try {
    const r = await testIntegration(toServiceContext(auth), id);
    revalidatePath("/settings");
    return r.ok ? { message: r.message } : { error: r.message };
  } catch (e) {
    return handle(e);
  }
}

export async function deleteIntegrationAction(formData: FormData) {
  const auth = await requirePageAuth("integration:manage");
  await deleteIntegration(toServiceContext(auth), z.uuid().parse(formData.get("integrationId")));
  revalidatePath("/settings");
}

export type SimulationState = { error?: string; result?: { label: string; status: number; outcome?: string; incidentNumber?: number | null; incidentId?: string | null; duplicate?: boolean; message?: string }[] };

async function selfBaseUrl() {
  if (process.env.LOOPMEND_INTERNAL_URL) return process.env.LOOPMEND_INTERNAL_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function simulateFailureAction(_prev: SimulationState, formData: FormData): Promise<SimulationState> {
  const auth = await requirePageAuth("demo:simulate");
  const parsed = z
    .object({ workflowId: z.uuid(), scenario: z.enum(Object.keys(SCENARIOS) as [Scenario, ...Scenario[]]), deliverTwice: z.string().optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Choose a workflow and scenario" };
  try {
    const { first, second } = await simulateFailure(toServiceContext(auth), {
      workflowId: parsed.data.workflowId,
      scenario: parsed.data.scenario,
      baseUrl: await selfBaseUrl(),
      deliverTwice: parsed.data.deliverTwice === "on",
    });
    const toRow = (label: string, r: typeof first) => ({
      label,
      status: r.status,
      outcome: r.body.data?.outcome as string | undefined,
      incidentNumber: r.body.data?.incidentNumber as number | null | undefined,
      incidentId: r.body.data?.incidentId as string | null | undefined,
      duplicate: r.body.data?.duplicate as boolean | undefined,
      message: r.body.error?.message,
    });
    revalidatePath("/", "layout");
    return { result: [toRow("Delivery", first), ...(second ? [toRow("Re-delivery (same body, new nonce)", second)] : [])] };
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    return { error: `Simulation failed: ${(e as Error).message}` };
  }
}
