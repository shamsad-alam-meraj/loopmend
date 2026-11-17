import Link from "next/link";
import { toServiceContext, type AuthContext } from "@/lib/auth";
import { detectWorkflowAnomalies } from "@/services/reliability.service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AnomalyList } from "@/components/analytics/anomaly-list";

/** Anomaly widget on the overview page. */
export async function OverviewExtras({ auth }: { auth: AuthContext }) {
  const anomalies = await detectWorkflowAnomalies(toServiceContext(auth));
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div><CardTitle>Anomalies</CardTitle><CardDescription>Statistical deviations from each workflow&apos;s 7-day baseline.</CardDescription></div>
        <Link href="/analytics" className="text-xs text-primary hover:underline">Analytics →</Link>
      </CardHeader>
      <CardContent><AnomalyList items={anomalies.slice(0, 4)} /></CardContent>
    </Card>
  );
}
