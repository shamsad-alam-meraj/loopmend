import Link from "next/link";
import { LogOut } from "lucide-react";
import { requirePageAuth } from "@/lib/auth";
import { logoutAction } from "@/actions/auth.actions";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { OrgSwitcher } from "@/components/dashboard/org-switcher";
import { getSidebarBadges } from "@/components/dashboard/badges";
import { LiveUpdates } from "@/components/dashboard/live-updates";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const auth = await requirePageAuth();
  const badges = await getSidebarBadges(auth);
  const initials = (auth.user.fullName ?? auth.user.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar p-3 md:flex">
        <Link href="/overview" className="mb-4 flex items-center gap-2 px-1.5 py-1 font-semibold">
          <Logo /> Loopmend
        </Link>
        <div className="mb-4 rounded-md border bg-card p-2.5">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Organization</span>
            <span className="flex items-center gap-2">
              <LiveUpdates orgId={auth.org.id} />
              {auth.org.isDemo && <Badge tone="warning">Demo</Badge>}
            </span>
          </div>
          <OrgSwitcher auth={auth} />
        </div>
        <SidebarNav badges={badges} />
        <div className="mt-auto flex items-center gap-2 border-t pt-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{auth.user.fullName ?? auth.user.email}</div>
            <div className="text-[11px] capitalize text-muted-foreground" data-testid="current-role">{auth.role}</div>
          </div>
          <ThemeToggle />
          <form action={logoutAction}>
            <Button variant="ghost" size="icon" aria-label="Sign out" type="submit"><LogOut /></Button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-3 md:hidden">
          <Link href="/overview" className="flex items-center gap-2 font-semibold"><Logo /> Loopmend</Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <form action={logoutAction}><Button variant="ghost" size="icon" aria-label="Sign out" type="submit"><LogOut /></Button></form>
          </div>
        </header>
        <div className="border-b px-4 py-2 md:hidden"><MobileNav /></div>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

function MobileNav() {
  return (
    <div className="overflow-x-auto">
      <SidebarNav />
    </div>
  );
}
