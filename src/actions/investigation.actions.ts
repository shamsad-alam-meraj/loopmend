"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { investigateIncident } from "@/services/investigation.service";
import { isAppError } from "@/lib/utils/errors";
import type { ActionResult } from "./incident.actions";

export async function investigateAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const auth = await requirePageAuth("incident:investigate");
  const id = z.uuid().safeParse(formData.get("incidentId"));
  if (!id.success) return { error: "Invalid incident" };
  try {
    const inv = await investigateIncident(toServiceContext(auth), id.data);
    revalidatePath(`/incidents/${id.data}`);
    return { message: inv.usedFallback ? "Investigation completed with the rules fallback (AI provider unavailable)" : "Investigation completed" };
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    throw e;
  }
}
