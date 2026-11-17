"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { features } from "@/lib/env";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { endSession, getCurrentUser, setActiveOrg, startLocalSession } from "@/lib/auth";
import { rateLimit } from "@/lib/http/rate-limit";
import { createLocalUser, findUserByEmail, verifyLocalCredentials } from "@/services/user.service";
import { createOrganization, listUserMemberships } from "@/services/organization.service";
import { DEMO_USERS } from "@/lib/db/demo-data";
import { isAppError } from "@/lib/utils/errors";

export type FormState = { error?: string; message?: string; fieldErrors?: Record<string, string> };

const loginSchema = z.object({ email: z.email("Enter a valid email"), password: z.string().min(1, "Password is required") });
const registerSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(80),
  email: z.email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters").max(128),
  organization: z.string().trim().min(2, "Organization name must be at least 2 characters").max(80),
});

async function throttle(scope: string) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const rl = rateLimit(`${scope}:${ip}`, { capacity: 10, refillPerSecond: 0.2 });
  return rl.allowed;
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/overview";
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await throttle("login"))) return { error: "Too many attempts. Please wait a minute." };
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { email, password } = parsed.data;

  if (isSupabaseConfigured) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: "Invalid email or password" };
  } else {
    const user = await verifyLocalCredentials(email, password);
    if (!user) return { error: "Invalid email or password" };
    await startLocalSession(user.id);
  }
  redirect(safeNext(formData.get("next")));
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await throttle("register"))) return { error: "Too many attempts. Please wait a minute." };
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { email, password, fullName, organization } = parsed.data;

  try {
    if (isSupabaseConfigured) {
      const supabase = await createSupabaseServerClient();
      const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, pending_org: organization }, emailRedirectTo: `${origin}/auth/callback?next=/onboarding` },
      });
      if (error) return { error: error.message };
      if (!data.session) return { message: "Check your inbox to confirm your email, then sign in." };
      redirect("/onboarding");
    }
    const user = await createLocalUser(email, password, fullName);
    const org = await createOrganization(user.id, organization);
    await startLocalSession(user.id);
    await setActiveOrg(org.id);
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    throw e;
  }
  redirect("/overview");
}

/** One-click demo sign-in (local/demo mode only). */
export async function demoLoginAction(formData: FormData) {
  if (!features.demoMode() || isSupabaseConfigured) redirect("/login?error=demo_disabled");
  const email = String(formData.get("email") ?? "");
  if (!DEMO_USERS.some((u) => u.email === email)) redirect("/login?error=unknown_demo_user");
  const user = await findUserByEmail(email);
  if (!user) redirect("/login?error=demo_not_seeded");
  await startLocalSession(user.id);
  const [first] = await listUserMemberships(user.id);
  if (first) await setActiveOrg(first.organization.id);
  redirect("/overview");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

export async function createOrganizationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const name = String(formData.get("name") ?? "");
  try {
    const org = await createOrganization(user.id, name);
    await setActiveOrg(org.id);
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    throw e;
  }
  redirect("/overview");
}

export async function switchOrganizationAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const orgId = String(formData.get("orgId") ?? "");
  const memberships = await listUserMemberships(user.id);
  // Only switch to organizations the user actually belongs to.
  if (memberships.some((m) => m.organization.id === orgId)) await setActiveOrg(orgId);
  redirect("/overview");
}
