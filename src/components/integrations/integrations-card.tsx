import { PlugZap } from "lucide-react";
import type { AuthContext } from "@/lib/auth";
import { toServiceContext } from "@/lib/auth";
import { listIntegrations } from "@/services/integration.service";
import { can } from "@/lib/security/rbac";
import { deleteIntegrationAction } from "@/actions/integration.actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRelative } from "@/lib/utils/format";
import { CreateIntegrationForm, IntegrationRowActions } from "./integration-forms";
import { CopyField } from "./secret-reveal";

export async function IntegrationsCard({ auth, appUrl }: { auth: AuthContext; appUrl: string }) {
  const rows = await listIntegrations(toServiceContext(auth));
  const manage = can(auth.role, "integration:manage");
  const webhookUrl = `${appUrl}/api/v1/webhooks/n8n/incident`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>n8n integrations</CardTitle>
        <CardDescription>
          Each integration has its own HMAC signing secret, stored with AES-256-GCM encryption. Requests must carry a valid signature,
          a timestamp within 5 minutes, and a single-use nonce.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CopyField label="Incident webhook endpoint" value={webhookUrl} />
        {rows.length === 0 ? (
          <EmptyState icon={<PlugZap />} title="No n8n instance connected" description="Connect n8n to start receiving signed failure events." />
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((r) => (
              <li key={r.id} className="grid gap-3 p-3 md:grid-cols-[1fr_auto]">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <Badge tone={r.status === "connected" ? "success" : r.status === "error" ? "danger" : "neutral"}>{r.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.baseUrl ?? "No API URL"} · API key {r.secretHint ?? "not set"} · last seen {formatRelative(r.lastVerifiedAt)}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">id {r.id}</div>
                </div>
                {manage && (
                  <div className="space-y-2">
                    <IntegrationRowActions integrationId={r.id} webhookUrl={webhookUrl} />
                    <form action={deleteIntegrationAction} className="text-right">
                      <input type="hidden" name="integrationId" value={r.id} />
                      <Button size="sm" variant="ghost" className="text-destructive" type="submit">Disconnect</Button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {manage && <CreateIntegrationForm webhookUrl={webhookUrl} />}
      </CardContent>
    </Card>
  );
}
