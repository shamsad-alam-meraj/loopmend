"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { criticalityEnum, sideEffectEnum } from "@schema";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { updateWorkflowSettings } from "@/services/workflow.service";
import { isAppError } from "@/lib/utils/errors";
import type { ActionResult } from "./incident.actions";

export async function updateWorkflowAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const auth = await requirePageAuth("workflow:manage");
  const parsed = z
    .object({
      workflowId: z.uuid(),
      criticality: z.enum(criticalityEnum.enumValues),
      sideEffectProfile: z.enum(sideEffectEnum.enumValues),
      autoRecoveryEnabled: z.string().optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid settings" };
  try {
    await updateWorkflowSettings(toServiceContext(auth), parsed.data.workflowId, {
      criticality: parsed.data.criticality,
      sideEffectProfile: parsed.data.sideEffectProfile,
      autoRecoveryEnabled: parsed.data.autoRecoveryEnabled === "on",
    });
    revalidatePath(`/workflows/${parsed.data.workflowId}`);
    return { message: "Settings saved" };
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    throw e;
  }
}
