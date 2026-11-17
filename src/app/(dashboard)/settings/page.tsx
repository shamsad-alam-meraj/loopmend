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
import type { Role } from "@schema";

export const metadata: Metadata = { title: "Settings" };

const ROLES: Role[] = ["owner", "admin", "operator", "viewer"];

export default async function SettingsPage() {
  const auth = await requirePageAuth();
  const ctx = toServiceContext(auth);
  const members = await listMembers(ctx);
  const canManage = can(auth.role, "member:manage");
  const roles = assignableRoles(auth.role);

  return (
    <>
      <PageHeader
        title="Settings"
        description={`${auth.org.name} · /${auth.org.slug}`}
        actions={<Link href="/onboarding" className={buttonVariants({ variant: "outline", size: "sm" })}>New organization</Link>}
      />
      <div className="space-y-6">
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
