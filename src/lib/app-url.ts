/**
 * Public base URL of this deployment, resolved on the server only (never
 * bundled into browser code). Order:
 *   1. APP_URL                         – explicit configuration
 *   2. NEXT_PUBLIC_APP_URL             – legacy name, still honoured
 *   3. VERCEL_PROJECT_PRODUCTION_URL   – set automatically by Vercel (production)
 *   4. VERCEL_URL                      – set automatically by Vercel (previews)
 */
export function appUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const explicit = env.APP_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercelHost = env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL : env.VERCEL_URL;
  return vercelHost ? `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : undefined;
}
