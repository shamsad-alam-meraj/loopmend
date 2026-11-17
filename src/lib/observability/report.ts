import "server-only";
import { randomUUID } from "node:crypto";
import { logger } from "@/lib/utils/logger";

/**
 * Minimal Sentry reporter using the public envelope endpoint, so we get
 * exception visibility without pulling the full SDK into every bundle.
 * No-ops unless SENTRY_DSN is configured.
 */
export async function reportError(error: unknown, context: Record<string, unknown> = {}): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error(err.message, { ...context, stack: err.stack?.split("\n").slice(0, 6).join("\n") });

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/\//g, "");
    const key = url.username;
    const endpoint = `${url.protocol}//${url.host}/api/${projectId}/envelope/`;
    const eventId = randomUUID().replace(/-/g, "");
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      environment: process.env.NODE_ENV,
      exception: { values: [{ type: err.name, value: err.message }] },
      extra: context,
    };
    const body = [
      JSON.stringify({ event_id: eventId, dsn, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=loopmend/0.1`,
      },
      body,
      signal: AbortSignal.timeout(2000),
    });
  } catch (sendError) {
    logger.warn("sentry report failed", { reason: String(sendError) });
  }
}
