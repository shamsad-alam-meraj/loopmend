import { sql } from "drizzle-orm";
import { ok, fail, route } from "@/lib/http/api";
import { databaseKind, getDb } from "@/lib/db/client";
import { AppError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

/** Describes the configured database host without revealing it (helps diagnose misconfiguration). */
function describeHost(raw: string | undefined): string {
  if (!raw) return "unset";
  const value = raw.trim();
  if (value !== raw) return "has_surrounding_whitespace";
  if (/^["']/.test(value)) return "wrapped_in_quotes";
  if (/^[A-Z_]+=/.test(value)) return "includes_variable_name";
  try {
    const u = new URL(value);
    if (/^db\.[a-z0-9]+\.supabase\.co$/.test(u.hostname)) return `supabase_direct_ipv6_only:${u.port || "5432"}`;
    if (/\.pooler\.supabase\.com$/.test(u.hostname)) return `supabase_pooler:${u.port || "5432"}`;
    if (u.hostname.includes("<") || u.hostname.includes("[")) return "placeholder_in_host";
    return "other";
  } catch {
    return "unparseable";
  }
}

/**
 * Maps a connection error to a safe, actionable category. Never includes the
 * message itself (it can contain hostnames or user names).
 */
function classifyDbError(e: unknown): string {
  // Node wraps multi-address connection failures in AggregateError; errors may also carry a cause.
  const outer = e as { code?: string; message?: string; name?: string; errors?: unknown[]; cause?: unknown };
  const inner = (outer?.errors?.[0] ?? outer?.cause) as typeof outer | undefined;
  const err = !outer?.code && inner ? inner : outer;
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  if (code === "28P01" || msg.includes("password authentication failed")) return "auth_failed: wrong password";
  if (msg.includes("tenant or user not found") || msg.includes("no tenant identifier")) return "user_not_found: use postgres.<project-ref> with the pooler";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host_not_found: check the host name";
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH") return "network_unreachable: use the pooler host (direct host is IPv6-only)";
  if (code === "ECONNREFUSED") return "connection_refused: check host/port";
  if (code === "3D000") return "database_not_found";
  if (code === "CONNECT_TIMEOUT" || msg.includes("timeout")) return "timeout";
  if (msg.includes("database_url is required")) return "not_configured: DATABASE_URL missing";
  if (msg.includes("invalid url") || code === "ERR_INVALID_URL") return "invalid_url: check the format / percent-encode the password";
  if (code === "42P01") return "schema_missing: run migrations";
  return code ? `error_code:${code}` : `unknown:${outer?.name ?? typeof e}`;
}

/**
 * GET /api/v1/health — liveness + database readiness. Returns 503 (never a
 * false success) when the database is unreachable. No secrets are exposed.
 */
export const GET = route(async (_req, { requestId }) => {
  const started = Date.now();
  let dbOk = false;
  let reason: string | undefined;
  try {
    const db = await Promise.race([getDb(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (e) {
    dbOk = false;
    reason = classifyDbError(e);
  }
  const body = {
    status: dbOk ? "ok" : "degraded",
    version: process.env.npm_package_version ?? "0.1.0",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    checks: { database: { ok: dbOk, kind: databaseKind(), latencyMs: Date.now() - started, ...(reason ? { reason, host: describeHost(process.env.DATABASE_URL) } : {}) } },
    time: new Date().toISOString(),
  };
  if (!dbOk) return fail(new AppError("SERVICE_UNAVAILABLE", "Database unavailable", body), requestId);
  return ok(body, requestId, { meta: { cache: "no-store" } });
});
