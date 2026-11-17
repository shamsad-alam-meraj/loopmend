import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session-token";

/**
 * Lightweight routing guard. NOT the authorization boundary — every Route
 * Handler, Server Action and service re-checks auth and role.
 *  - Refreshes Supabase sessions (when configured)
 *  - Redirects signed-out users away from the dashboard
 *  - Redirects signed-in users away from /login and /register
 */
const DASHBOARD_PREFIXES = ["/overview", "/workflows", "/incidents", "/investigations", "/recoveries", "/approvals", "/analytics", "/settings", "/audit", "/onboarding"];
const AUTH_PAGES = ["/login", "/register"];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 32 ? s : "dev-only-insecure-secret-do-not-use-in-production-000";
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request });
  let signedIn = false;

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  } else {
    signedIn = Boolean(verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, sessionSecret()));
  }

  const isDashboard = DASHBOARD_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isDashboard && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  if (AUTH_PAGES.includes(pathname) && signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/overview";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Skip static assets and machine-to-machine APIs (they authenticate themselves).
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|api/).*)"],
};
