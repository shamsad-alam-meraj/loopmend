"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { roleEnum } from "@schema";
import { addMember, changeMemberRole, removeMember } from "@/services/organization.service";
import { isAppError } from "@/lib/utils/errors";
import type { FormState } from "./auth.actions";

const roleSchema = z.enum(roleEnum.enumValues);

async function run(fn: () => Promise<unknown>, okMessage: string): Promise<FormState> {
  try {
    await fn();
    revalidatePath("/settings");
    return { message: okMessage };
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    throw e;
  }
}

export async function addMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requirePageAuth("member:manage");
  const parsed = z.object({ email: z.email(), role: roleSchema }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email and role" };
  return run(() => addMember(toServiceContext(auth), parsed.data.email, parsed.data.role), "Member added");
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const auth = await requirePageAuth("member:manage");
  const parsed = z.object({ membershipId: z.uuid(), role: roleSchema }).parse(Object.fromEntries(formData));
  await changeMemberRole(toServiceContext(auth), parsed.membershipId, parsed.role);
  revalidatePath("/settings");
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const auth = await requirePageAuth("member:manage");
  const { membershipId } = z.object({ membershipId: z.uuid() }).parse(Object.fromEntries(formData));
  await removeMember(toServiceContext(auth), membershipId);
  revalidatePath("/settings");
}
