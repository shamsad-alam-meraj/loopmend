import type { NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { subscribeOrgEvents } from "@/lib/realtime/bus";
import { isAppError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Server-Sent Events change feed for the caller's active organization.
 * Streams close after ~50s (serverless limits); EventSource reconnects
 * automatically. Multi-instance deployments use Supabase Realtime instead.
 */
export async function GET(req: NextRequest) {
  let orgId: string;
  try {
    orgId = (await requireApiAuth("dashboard:read")).org.id;
  } catch (e) {
    return new Response(isAppError(e) ? e.message : "Unauthorized", { status: isAppError(e) ? e.status : 401 });
  }
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send(`retry: 3000\nevent: ready\ndata: {}\n\n`);
      const unsubscribe = subscribeOrgEvents(orgId, (e) => send(`event: change\ndata: ${JSON.stringify(e)}\n\n`));
      const heartbeat = setInterval(() => send(`: ping\n\n`), 15_000);
      const timeout = setTimeout(() => cleanup(), 50_000);
      cleanup = () => {
        clearInterval(heartbeat);
        clearTimeout(timeout);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
