import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import * as schema from "@schema";
import { createTestDb } from "../support/db";
import { seedDemo } from "@/lib/db/seed";
import { POST } from "@/app/api/v1/webhooks/n8n/incident/route";
import { HEADER, signPayload } from "@/lib/n8n/signing";
import { createIntegration } from "@/services/integration.service";
import { resetRateLimits } from "@/lib/http/rate-limit";
import type { Db } from "@/lib/db/client";

let db: Db;
let close: () => Promise<void>;
let integrationId: string;
let secret: string;
let orgId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const ids = await seedDemo(db, Date.now(), { days: 3 });
  orgId = ids.acme;
  const created = await createIntegration(
    { organizationId: orgId, actor: { type: "user", id: ids.userIds.get("admin@demo.loopmend.dev")! }, role: "admin" },
    { name: "Test n8n" },
  );
  integrationId = created.integration.id;
  secret = created.webhookSecret;
});
afterAll(async () => close());

function send(body: string, opts: { nonce?: string; now?: number; secret?: string; integration?: string } = {}) {
  resetRateLimits();
  const headers = signPayload(opts.secret ?? secret, body, { nonce: opts.nonce, now: opts.now });
  return POST(
    new NextRequest("http://localhost/api/v1/webhooks/n8n/incident", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", [HEADER.integration]: opts.integration ?? integrationId, ...headers },
    }),
    undefined as never,
  );
}

const canonical = (eventId: string, executionId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    event: "workflow.execution.failed",
    eventId,
    source: "n8n",
    workflow: { id: "workflow_123", name: "Payment Notification (test)" },
    execution: { id: executionId, status: "error", durationMs: 3400, error: { code: "RATE_LIMITED", message: "HTTP 429: Too Many Requests", node: "Send" } },
    occurredAt: new Date().toISOString(),
    ...extra,
  });

async function incidentCount() {
  const rows = await db.select().from(schema.incidents).where(eq(schema.incidents.organizationId, orgId));
  return rows.length;
}

describe("POST /api/v1/webhooks/n8n/incident", () => {
  let incidentId: string;

  it("accepts a valid signed event and opens an incident (standard envelope)", async () => {
    const before = await incidentCount();
    const res = await send(canonical("evt_test_1", "exec_1"));
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, error: null, data: { outcome: "incident_created", status: "open", duplicate: false } });
    expect(json.meta.requestId).toMatch(/^req_/);
    incidentId = json.data.incidentId;
    expect(await incidentCount()).toBe(before + 1);
    const [inc] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, incidentId));
    expect(inc).toMatchObject({ category: "rate_limit", errorCode: "RATE_LIMITED", status: "open" });
  });

  it("does not duplicate incidents for re-delivered events (same body, new nonce)", async () => {
    const body = canonical("evt_dup", "exec_dup", { workflow: { id: "wf_dup", name: "Dup Flow" } });
    const before = await incidentCount();
    const first = await send(body);
    expect(first.status).toBe(202);
    const a = await first.json();
    const second = await send(body);
    expect(second.status).toBe(200);
    expect((await second.json()).data).toMatchObject({ duplicate: true, outcome: "duplicate", incidentId: a.data.incidentId });
    expect(await incidentCount()).toBe(before + 1);
  });

  it("rejects reuse of an eventId with a different payload", async () => {
    const res = await send(canonical("evt_test_1", "exec_other"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONFLICT");
  });

  it("rejects replayed requests (same nonce)", async () => {
    const body = canonical("evt_replay", "exec_replay");
    const nonce = "replay-nonce-0123456789";
    expect((await send(body, { nonce })).status).toBe(202);
    const replay = await send(body, { nonce });
    expect(replay.status).toBe(409);
    expect((await replay.json()).error.code).toBe("REPLAY_DETECTED");
  });

  it("rejects invalid signatures, stale timestamps and unknown integrations", async () => {
    const body = canonical("evt_bad", "exec_bad");
    const bad = await send(body, { secret: "x".repeat(64) });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error.code).toBe("INVALID_SIGNATURE");
    expect((await send(body, { now: Date.now() - 10 * 60_000 })).status).toBe(401);
    expect((await send(body, { integration: "00000000-0000-0000-0000-000000000000" })).status).toBe(401);
    const [ledger] = await db.select().from(schema.ingestedEvents).where(eq(schema.ingestedEvents.eventId, "evt_bad"));
    expect(ledger).toBeUndefined();
  });

  it("rejects malformed payloads and oversized bodies", async () => {
    const res = await send(JSON.stringify({ workflow: {} }));
    expect(res.status).toBe(422);
    expect((await send("{not json")).status).toBe(400);
    const huge = JSON.stringify({ pad: "x".repeat(300 * 1024) });
    expect((await send(huge)).status).toBe(413);
    // Chunked upload without content-length is cut off while streaming, before buffering it all.
    const chunks = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 64; i++) c.enqueue(new Uint8Array(16 * 1024).fill(120));
        c.close();
      },
    });
    resetRateLimits();
    const chunked = await POST(
      new NextRequest("http://localhost/api/v1/webhooks/n8n/incident", { method: "POST", body: chunks, duplex: "half", headers: { [HEADER.integration]: integrationId } } as never),
      undefined as never,
    );
    expect(chunked.status).toBe(413);
  });

  it("correlates a new failure with the same signature as a recurrence", async () => {
    const [before] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, incidentId));
    const res = await send(canonical("evt_test_2", "exec_2"));
    const json = await res.json();
    expect(json.data).toMatchObject({ outcome: "incident_recurred", incidentId });
    const [after] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, incidentId));
    expect(after.occurrenceCount).toBe(before.occurrenceCount + 1);
    const events = await db.select().from(schema.incidentEvents).where(eq(schema.incidentEvents.incidentId, incidentId));
    expect(events.filter((e) => e.eventType === "recurred").length).toBe(after.occurrenceCount - 1);
  });

  it("is safe under concurrent duplicate deliveries", async () => {
    const before = await incidentCount();
    const body = canonical("evt_concurrent", "exec_concurrent", { workflow: { id: "wf_concurrency", name: "Concurrency" } });
    const results = await Promise.all(Array.from({ length: 6 }, () => send(body)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 202)).toHaveLength(1);
    expect(await incidentCount()).toBe(before + 1);
    const ledger = await db.select().from(schema.ingestedEvents).where(and(eq(schema.ingestedEvents.organizationId, orgId), eq(schema.ingestedEvents.eventId, "evt_concurrent")));
    expect(ledger).toHaveLength(1);
  });

  it("normalizes raw n8n Error Trigger payloads and records successes", async () => {
    const raw = JSON.stringify({
      execution: { id: "9001", error: { message: "HTTP 401: Unauthorized - token expired", httpCode: "401" }, lastNodeExecuted: "CRM Upsert", mode: "trigger" },
      workflow: { id: "wf_raw", name: "Raw Payload Flow" },
    });
    const res = await send(raw);
    expect(res.status).toBe(202);
    const [inc] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, (await res.json()).data.incidentId));
    expect(inc.category).toBe("authentication");

    const ok = await send(JSON.stringify({ ...JSON.parse(canonical("evt_success", "exec_success")), event: "workflow.execution.succeeded", execution: { id: "exec_success", status: "success", durationMs: 1200 } }));
    expect((await ok.json()).data).toMatchObject({ outcome: "execution_recorded", incidentId: null });
  });

  it("marks the integration as connected after a verified event", async () => {
    const [row] = await db.select().from(schema.integrations).where(eq(schema.integrations.id, integrationId));
    expect(row.status).toBe("connected");
    expect(row.encryptedConfig).not.toContain(secret);
  });
});
