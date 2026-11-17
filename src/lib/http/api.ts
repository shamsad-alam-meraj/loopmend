import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, isAppError } from "@/lib/utils/errors";
import { prefixedId } from "@/lib/utils/ids";
import { reportError } from "@/lib/observability/report";
import { rateLimit } from "./rate-limit";

export type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  meta: { requestId: string } & Record<string, unknown>;
};

export const MAX_JSON_BYTES = 256 * 1024;

export function ok<T>(data: T, requestId: string, init?: { status?: number; meta?: Record<string, unknown> }) {
  const body: ApiEnvelope<T> = { success: true, data, error: null, meta: { requestId, ...init?.meta } };
  return NextResponse.json(body, { status: init?.status ?? 200, headers: { "x-request-id": requestId } });
}

export function fail(error: AppError, requestId: string, headers: Record<string, string> = {}) {
  const body: ApiEnvelope<null> = {
    success: false,
    data: null,
    error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    meta: { requestId },
  };
  return NextResponse.json(body, { status: error.status, headers: { "x-request-id": requestId, ...headers } });
}

export function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local").slice(0, 64);
}

/** Read the body as text with a hard size cap (protects against huge payloads). */
export async function readBodyText(req: Request, maxBytes = MAX_JSON_BYTES): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", `Body exceeds ${maxBytes} bytes`);
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", `Body exceeds ${maxBytes} bytes`);
  return text;
}

export function parseJson<T>(text: string, schema: ZodType<T>): T {
  let raw: unknown;
  try {
    raw = text.length ? JSON.parse(text) : {};
  } catch {
    throw new AppError("BAD_REQUEST", "Body is not valid JSON");
  }
  return validate(raw, schema);
}

export function validate<T>(raw: unknown, schema: ZodType<T>): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Request validation failed",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  return parseJson(await readBodyText(req), schema);
}

type Handler<C> = (req: NextRequest, ctx: C & { requestId: string }) => Promise<Response>;

/**
 * Wraps a Route Handler with: request id, rate limiting, error → envelope
 * mapping, and error reporting. Authorization is done inside each handler /
 * service (never only here).
 */
export function route<C = unknown>(
  handler: Handler<C>,
  opts: { rateLimit?: { capacity: number; refillPerSecond: number }; name?: string } = {},
) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || prefixedId("req");
    try {
      if (opts.rateLimit) {
        const rl = rateLimit(`${opts.name ?? req.nextUrl.pathname}:${clientKey(req)}`, opts.rateLimit);
        if (!rl.allowed) {
          return fail(new AppError("RATE_LIMITED", "Too many requests"), requestId, {
            "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)),
          });
        }
      }
      return await handler(req, { ...(ctx as C), requestId });
    } catch (error) {
      if (isAppError(error)) return fail(error, requestId);
      if (error instanceof ZodError) return fail(new AppError("VALIDATION_FAILED", "Validation failed"), requestId);
      await reportError(error, { requestId, path: req.nextUrl.pathname });
      // Never return a false success: unexpected failures (e.g. DB outage) are surfaced as 500/503.
      const message = error instanceof Error && /ECONNREFUSED|connect|database|timeout/i.test(error.message)
        ? new AppError("SERVICE_UNAVAILABLE", "A dependency is unavailable. Please retry.")
        : new AppError("INTERNAL", "Unexpected server error");
      return fail(message, requestId);
    }
  };
}
