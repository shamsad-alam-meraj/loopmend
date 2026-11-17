import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { workflows } from "@schema";
import { requirePageAuth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { can } from "@/lib/security/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SimulateFailure } from "@/components/incidents/simulate-failure";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const auth = await requirePageAuth();
  const db = await getDb();
  const wfs = await db.select({ id: workflows.id, name: workflows.name }).from(workflows).where(eq(workflows.organizationId, auth.org.id));
  return (
    <>
      <PageHeader title={`Welcome, ${auth.user.fullName ?? auth.user.email}`} description={`${auth.org.name} · signed in as ${auth.role}`} />
      {can(auth.role, "demo:simulate") && (
        <Card>
          <CardHeader>
            <CardTitle>Failure simulator</CardTitle>
            <CardDescription>Sends a signed n8n Error Trigger payload through the public webhook — the same path real failures take.</CardDescription>
          </CardHeader>
          <CardContent><SimulateFailure workflows={wfs} /></CardContent>
        </Card>
      )}
    </>
  );
}
