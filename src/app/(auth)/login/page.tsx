import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoginForm } from "@/components/auth/login-form";
import { demoLoginAction } from "@/actions/auth.actions";
import { DEMO_USERS } from "@/lib/db/demo-data";
import { features } from "@/lib/env";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  auth_callback: "We couldn't complete sign-in. Please try again.",
  demo_disabled: "Demo sign-in is disabled in this environment.",
  demo_not_seeded: "Demo data has not been seeded yet.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const showDemo = features.demoMode() && !isSupabaseConfigured;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign in</CardTitle>
          <CardDescription>Access your organization&apos;s reliability workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <LoginForm next={next} />
          <p className="text-center text-xs text-muted-foreground">
            No account? <Link href="/register" className="text-primary hover:underline">Create one</Link>
          </p>
        </CardContent>
      </Card>

      {showDemo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Explore the demo workspace</CardTitle>
            <CardDescription>Sign in as a seeded user to see how each role&apos;s permissions differ. All demo data is synthetic.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {DEMO_USERS.map((u) => (
              <form key={u.email} action={demoLoginAction}>
                <input type="hidden" name="email" value={u.email} />
                <Button type="submit" variant="outline" size="sm" className="w-full justify-start" data-testid={`demo-${u.role}-${u.org}`}>
                  <span className="capitalize">{u.role}</span>
                  <span className="truncate text-muted-foreground">· {u.org === "acme" ? "Acme" : "Globex"}</span>
                </Button>
              </form>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
