"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recoveryStrategyEnum } from "@schema";
import "@/services/hooks";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { createRecoveryPlan, decideRecoveryPlan, executeRecoveryPlan } from "@/services/recovery.service";
import { isAppError } from "@/lib/utils/errors";
import type { ActionResult } from "./incident.actions";

function refresh(incidentId?: string) {
  if (incidentId) revalidatePath(`/incidents/${incidentId}`);
  revalidatePath("/recoveries");
  revalidatePath("/approvals");
}

async function run(fn: () => Promise<string>, incidentId?: string): Promise<ActionResult> {
  try {
    const message = await fn();
    refresh(incidentId);
    return { message };
  } catch (e) {
    if (isAppError(e)) {
      const failed = (e.details as { checks?: { detail: string }[] } | undefined)?.checks?.map((c) => c.detail).join("; ");
      return { error: failed ? `${e.message} — ${failed}` : e.message };
    }
    throw e;
  }
}

export async function proposePlanAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const auth = await requirePageAuth("recovery:create");
  const p = z.object({ incidentId: z.uuid(), strategy: z.enum(recoveryStrategyEnum.enumValues).optional().or(z.literal("").transform(() => undefined)) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Invalid request" };
  return run(async () => {
    const { plan, duplicate } = await createRecoveryPlan(toServiceContext(auth), { incidentId: p.data.incidentId, strategy: p.data.strategy });
    if (duplicate) return "Plan already exists";
    return plan.status === "pending_approval" ? "Plan created — awaiting approval" : `Plan ${plan.status.replace("_", " ")}`;
  }, p.data.incidentId);
}

export async function decidePlanAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const auth = await requirePageAuth("recovery:approve");
  const p = z.object({ planId: z.uuid(), incidentId: z.uuid(), decision: z.enum(["approved", "rejected"]), comment: z.string().max(1000).optional() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Invalid request" };
  return run(async () => {
    await decideRecoveryPlan(toServiceContext(auth), p.data.planId, p.data.decision, p.data.comment || undefined);
    return p.data.decision === "approved" ? "Approved — ready to execute" : "Rejected";
  }, p.data.incidentId);
}

export async function executePlanAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const auth = await requirePageAuth("recovery:execute");
  const p = z.object({ planId: z.uuid(), incidentId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Invalid request" };
  return run(async () => {
    const out = await executeRecoveryPlan(toServiceContext(auth), p.data.planId);
    if (out.duplicate) return "Already recovered — no duplicate execution";
    if (!out.result) return `Plan moved to ${out.plan.status.replace("_", " ")}`;
    return `${out.result.status === "succeeded" ? "✓" : out.result.status === "accepted" ? "→" : "✗"} ${out.result.message}${out.plan.status === "approved" && out.plan.nextAttemptAt ? ` · next attempt scheduled with backoff` : ""}`;
  }, p.data.incidentId);
}
