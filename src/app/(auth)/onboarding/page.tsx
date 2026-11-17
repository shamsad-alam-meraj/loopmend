import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOrgForm } from "@/components/auth/create-org-form";
import { getAuthContext } from "@/lib/auth";

export const metadata: Metadata = { title: "Create organization" };

export default async function OnboardingPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create an organization</CardTitle>
        <CardDescription>
          {auth.memberships.length === 0
            ? "You're not a member of any organization yet. Create one to start monitoring workflows, or ask an admin to add you."
            : "Create an additional organization. You'll be its owner."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CreateOrgForm />
      </CardContent>
    </Card>
  );
}
