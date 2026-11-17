import { sql } from "drizzle-orm";
import { ok, fail, route } from "@/lib/http/api";
import { databaseKind, getDb } from "@/lib/db/client";
import { AppError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health — liveness + database readiness. Returns 503 (never a
 * false success) when the database is unreachable. No secrets are exposed.
 */
export const GET = route(async (_req, { requestId }) => {
  const started = Date.now();
  let dbOk = false;
  try {
    const db = await Promise.race([getDb(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const body = {
    status: dbOk ? "ok" : "degraded",
    version: process.env.npm_package_version ?? "0.1.0",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    checks: { database: { ok: dbOk, kind: databaseKind(), latencyMs: Date.now() - started } },
    time: new Date().toISOString(),
  };
  if (!dbOk) return fail(new AppError("SERVICE_UNAVAILABLE", "Database unavailable", body), requestId);
  return ok(body, requestId, { meta: { cache: "no-store" } });
});
