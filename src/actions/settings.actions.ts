"use server";

import { revalidatePath } from "next/cache";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { setStatusPage } from "@/services/insights.service";

export async function toggleStatusPageAction(formData: FormData) {
  const auth = await requirePageAuth("org:settings");
  await setStatusPage(toServiceContext(auth), formData.get("enabled") === "true");
  revalidatePath("/settings");
}
