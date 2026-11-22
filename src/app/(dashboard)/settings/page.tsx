import { appUrl } from "@/lib/app-url";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageAuth, toServiceContext } from "@/lib/auth";
import { listMembers } from "@/services/organization.service";
import { assignableRoles, can, PERMISSIONS, ROLE_RANK } from "@/lib/security/rbac";
import { changeRoleAction, removeMemberAction } from "@/actions/organization.actions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { AddMemberForm } from "@/components/dashboard/add-member-form";
import { formatRelative } from "@/lib/utils/format";
import { IntegrationsCard } from "@/components/integrations/integrations-card";
import { toggleStatusPageAction } from "@/actions/settings.actions";
import { getDb } from "@/lib/db/client";
import { organizations } from "@schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { Role } from "@schema";

export const metadata: Metadata = { title: "Settings" };

const ROLES: Role[] = ["owner", "admin", "operator", "viewer"];

export default async function SettingsPage() {
  const auth = await requirePageAuth();
  const ctx = toServiceContext(auth);
  const members = await listMembers(ctx);
  const canManage = can(auth.role, "member:manage");
  const roles = assignableRoles(auth.role);
  const [orgRow] = await (await getDb()).select({ enabled: organizations.statusPageEnabled }).from(organizations).where(eq(organizations.id, auth.org.id));
  const statusEnabled = orgRow?.enabled ?? false;
  const h = await headers();
  const baseUrl = appUrl() || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;

  return (
    <>
      <PageHeader
        title="Settings"
        description={`${auth.org.name} · /${auth.org.slug}`}
        actions={<Link href="/onboarding" className={buttonVariants({ variant: "outline", size: "sm" })}>New organization</Link>}
      />
      <div className="space-y-6">
        <IntegrationsCard auth={auth} appUrl={baseUrl} />
        <Card>
          <CardHeader>
            <CardTitle>Public status page</CardTitle>
            <CardDescription>Opt-in page showing aggregate workflow health only. No incident details, errors or members are exposed.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            {statusEnabled ? (
              <Link href={`/status/${auth.org.slug}`} className="text-sm text-primary hover:underline" target="_blank">{baseUrl}/status/{auth.org.slug}</Link>
            ) : (
              <span className="text-sm text-muted-foreground">Disabled</span>
            )}
            {can(auth.role, "org:settings") && (
              <form action={toggleStatusPageAction}>
                <input type="hidden" name="enabled" value={statusEnabled ? "false" : "true"} />
                <Button size="sm" variant={statusEnabled ? "outline" : "default"} type="submit">{statusEnabled ? "Disable" : "Enable"} status page</Button>
              </form>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>Roles are enforced server-side on every request and by database row-level security.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {canManage && <AddMemberForm roles={roles} />}
            <Table>
              <THead><TR><TH>Member</TH><TH>Role</TH><TH>Joined</TH>{canManage && <TH className="text-right">Actions</TH>}</TR></THead>
              <TBody>
                {members.map((m) => {
                  const editable = canManage && m.userId !== auth.user.id && (m.role !== "owner" || auth.role === "owner");
                  return (
                    <TR key={m.id}>
                      <TD>
                        <div className="font-medium">{m.fullName ?? m.email}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </TD>
                      <TD>
                        {editable ? (
                          <form action={changeRoleAction} className="flex items-center gap-2">
                            <input type="hidden" name="membershipId" value={m.id} />
                            <Select name="role" defaultValue={m.role} className="h-8 w-28 text-xs">
                              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                            </Select>
                            <Button size="sm" variant="outline" type="submit">Save</Button>
                          </form>
                        ) : (
                          <Badge tone={m.role === "owner" ? "primary" : "neutral"} className="capitalize">{m.role}{m.userId === auth.user.id ? " (you)" : ""}</Badge>
                        )}
                      </TD>
                      <TD className="text-xs text-muted-foreground">{formatRelative(m.createdAt)}</TD>
                      {canManage && (
                        <TD className="text-right">
                          {editable && (
                            <form action={removeMemberAction}>
                              <input type="hidden" name="membershipId" value={m.id} />
                              <Button size="sm" variant="ghost" className="text-destructive" type="submit">Remove</Button>
                            </form>
                          )}
                        </TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Permission matrix</CardTitle>
            <CardDescription>What each role can do in this organization.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead><TR><TH>Permission</TH>{ROLES.map((r) => <TH key={r} className="text-center capitalize">{r}</TH>)}</TR></THead>
              <TBody>
                {Object.entries(PERMISSIONS).map(([perm, min]) => (
                  <TR key={perm}>
                    <TD className="font-mono text-xs">{perm}</TD>
                    {ROLES.map((r) => (
                      <TD key={r} className="text-center">{ROLE_RANK[r] >= ROLE_RANK[min] ? "✓" : <span className="text-muted-foreground">—</span>}</TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
