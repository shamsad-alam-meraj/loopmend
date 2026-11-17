"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { severityEnum } from "@schema";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { updateIncident } from "@/services/incident.service";
import { isAppError } from "@/lib/utils/errors";

export type ActionResult = { error?: string; message?: string };

const schema = z.object({
  incidentId: z.uuid(),
  action: z.enum(["acknowledge", "resolve", "dismiss", "reopen", "assign_self", "unassign"]).optional(),
  severity: z.enum(severityEnum.enumValues).optional(),
  note: z.string().trim().max(1000).optional().transform((v) => v || undefined),
});

export async function updateIncidentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const auth = await requirePageAuth("incident:update");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request" };
  const { incidentId, ...input } = parsed.data;
  try {
    await updateIncident(toServiceContext(auth), incidentId, input);
    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath("/incidents");
    return { message: "Updated" };
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    throw e;
  }
}
