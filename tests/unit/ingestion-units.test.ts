import { describe, expect, it } from "vitest";
import { signPayload, verifySignature, HEADER } from "@/lib/n8n/signing";
import { normalizeN8nPayload, sanitizeText } from "@/lib/n8n/adapter";
import { classifyError, deriveSeverity, normalizeErrorCode } from "@/lib/incidents/classifier";

const SECRET = "s".repeat(64);

describe("webhook signing", () => {
  const body = JSON.stringify({ hello: "world" });
  const now = Date.parse("2026-11-17T10:00:00Z");
  const h = signPayload(SECRET, body, { now, nonce: "nonce-0123456789abcdef" });
  const headers = { signature: h[HEADER.signature], timestamp: h[HEADER.timestamp], nonce: h[HEADER.nonce] };

  it("accepts a valid signature", () => {
    expect(verifySignature(SECRET, body, headers, now)).toMatchObject({ ok: true });
  });
  it("rejects modified body, wrong secret, swapped nonce", () => {
    expect(verifySignature(SECRET, body + " ", headers, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySignature("t".repeat(64), body, headers, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySignature(SECRET, body, { ...headers, nonce: "nonce-ffffffffffffffff" }, now)).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("rejects stale, future, missing, malformed", () => {
    expect(verifySignature(SECRET, body, headers, now + 301_000)).toEqual({ ok: false, reason: "stale" });
    expect(verifySignature(SECRET, body, headers, now - 301_000)).toEqual({ ok: false, reason: "future" });
    expect(verifySignature(SECRET, body, { ...headers, nonce: null }, now)).toEqual({ ok: false, reason: "missing_headers" });
    expect(verifySignature(SECRET, body, { ...headers, nonce: "short" }, now)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("n8n adapter", () => {
  it("normalizes a raw Error Trigger payload", () => {
    const e = normalizeN8nPayload({
      execution: { id: "231", error: { message: "HTTP 429: Too Many Requests", httpCode: "429", node: { name: "HTTP Request" } }, lastNodeExecuted: "HTTP Request", mode: "trigger" },
      workflow: { id: "workflow_123", name: "Payment Notification" },
    });
    expect(e).toMatchObject({
      event: "workflow.execution.failed",
      source: "n8n",
      workflow: { id: "workflow_123", name: "Payment Notification" },
      execution: { id: "231", status: "error", error: { code: "RATE_LIMITED", httpStatus: 429, node: "HTTP Request" } },
    });
    // Deterministic event id so re-deliveries of the same execution dedupe.
    const again = normalizeN8nPayload({ execution: { id: "231", error: { message: "x" } }, workflow: { id: "workflow_123", name: "P" } });
    expect(again.eventId).toBe(e.eventId);
  });

  it("handles trigger-level failures without an execution id", () => {
    const e = normalizeN8nPayload({ trigger: { error: { message: "Polling failed: ECONNREFUSED" }, mode: "trigger" }, workflow: { id: "7", name: "Poller" } });
    expect(e.execution.id).toMatch(/^trigger_/);
  });

  it("passes through canonical payloads and rejects junk", () => {
    const canonical = {
      event: "workflow.execution.failed",
      eventId: "evt_01JXYZ",
      source: "n8n",
      workflow: { id: "workflow_123", name: "Payment Notification" },
      execution: { id: "execution_456", status: "error", durationMs: 3400, error: { code: "RATE_LIMITED", message: "HTTP 429: Too Many Requests" } },
      occurredAt: "2026-11-17T10:00:00Z",
    };
    expect(normalizeN8nPayload(canonical).eventId).toBe("evt_01JXYZ");
    expect(() => normalizeN8nPayload({ foo: 1 })).toThrow(/workflow.id/);
    expect(() => normalizeN8nPayload({ ...canonical, eventId: "bad id with spaces" })).toThrow();
  });

  it("redacts secrets and PII from error text", () => {
    const s = sanitizeText("Authorization: Bearer abc.def.ghi failed for jane@corp.com api_key=sk_live_123 card 4242 4242 4242 4242");
    expect(s).not.toMatch(/abc\.def|jane@corp|sk_live_123|4242 4242/);
  });
});

describe("classifier", () => {
  it.each([
    [{ httpStatus: 429, message: "x" }, "rate_limit"],
    [{ message: "HTTP 401: OAuth access token expired" }, "authentication"],
    [{ message: "ETIMEDOUT after 30000ms" }, "timeout"],
    [{ message: "socket hang up (ECONNRESET)" }, "network"],
    [{ message: "HTTP 503: Service Unavailable" }, "upstream_outage"],
    [{ message: "Field 'email' is required but was empty" }, "validation"],
    [{ message: "Credential 'Slack Bot' not found", code: "CONFIG_MISSING" }, "configuration"],
    [{ message: "¯\\_(ツ)_/¯" }, "unknown"],
  ] as const)("%o → %s", (signal, category) => {
    expect(classifyError(signal).category).toBe(category);
  });
  it("derives severity from category, criticality and recurrence", () => {
    expect(deriveSeverity("rate_limit", "medium")).toBe("medium");
    expect(deriveSeverity("rate_limit", "critical")).toBe("high");
    expect(deriveSeverity("authentication", "critical", 6)).toBe("critical");
    expect(deriveSeverity("network", "low")).toBe("low");
    expect(normalizeErrorCode({ message: "HTTP 502 bad gateway" }, "upstream_outage")).toBe("HTTP_502");
  });
});
