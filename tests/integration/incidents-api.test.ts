import "../support/request-context";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import * as schema from "@schema";
import { createTestDb } from "../support/db";
import { signInAs } from "../support/session";
import { requestContext } from "../support/request-context";
import { seedDemo } from "@/lib/db/seed";
import "@/lib/db/seed-incidents";
import { GET as listGET } from "@/app/api/v1/incidents/route";
import { GET as getGET, PATCH } from "@/app/api/v1/incidents/[id]/route";
import { GET as execGET } from "@/app/api/v1/workflows/[id]/executions/route";
import { GET as wfGET } from "@/app/api/v1/workflows/route";
import { resetRateLimits } from "@/lib/http/rate-limit";
import { listIncidents, updateIncident } from "@/services/incident.service";
import type { Db } from "@/lib/db/client";

let db: Db;
let close: () => Promise<void>;
let ids: Awaited<ReturnType<typeof seedDemo>>;
const user = (email: string) => ids.userIds.get(email)!;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  ids = await seedDemo(db, Date.now(), { days: 3 });
});
afterAll(async () => close());

const req = (url: string, init?: RequestInit) => {
  resetRateLimits();
  return new NextRequest(`http://localhost${url}`, init as never);
};
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) }) as never;

async function anAcmeIncident() {
  const [inc] = await db.select().from(schema.incidents).where(eq(schema.incidents.organizationId, ids.acme)).limit(1);
  return inc;
}

describe("incidents REST API", () => {
  it("requires authentication", async () => {
    signInAs(undefined);
    const res = await listGET(req("/api/v1/incidents"), undefined as never);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("lists active incidents for the caller's organization only", async () => {
    signInAs(user("viewer@demo.loopmend.dev"));
    const res = await listGET(req("/api/v1/incidents?view=all&limit=100"), undefined as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    const orgIds = new Set(json.data.map((i: { organizationId: string }) => i.organizationId));
    expect([...orgIds]).toEqual([ids.acme]);
  });

  it("denies cross-organization reads (404) and org header spoofing (403)", async () => {
    const inc = await anAcmeIncident();
    signInAs(user("owner@globex.loopmend.dev"));
    const res = await getGET(req(`/api/v1/incidents/${inc.id}`), params({ id: inc.id }));
    expect(res.status).toBe(404);

    requestContext.headers.set("x-organization-id", ids.acme);
    const spoof = await listGET(req("/api/v1/incidents"), undefined as never);
    expect(spoof.status).toBe(403);
  });

  it("lets viewers read but not update", async () => {
    const inc = await anAcmeIncident();
    signInAs(user("viewer@demo.loopmend.dev"));
    expect((await getGET(req(`/api/v1/incidents/${inc.id}`), params({ id: inc.id }))).status).toBe(200);
    const res = await PATCH(req(`/api/v1/incidents/${inc.id}`, { method: "PATCH", body: JSON.stringify({ action: "resolve" }) }), params({ id: inc.id }));
    expect(res.status).toBe(403);
  });

  it("lets operators acknowledge and resolve, with timeline + audit", async () => {
    const inc = await anAcmeIncident();
    signInAs(user("operator@demo.loopmend.dev"));
    const ack = await PATCH(req(`/api/v1/incidents/${inc.id}`, { method: "PATCH", body: JSON.stringify({ action: "acknowledge", note: "on it" }) }), params({ id: inc.id }));
    expect(ack.status).toBe(200);
    const again = await PATCH(req(`/api/v1/incidents/${inc.id}`, { method: "PATCH", body: JSON.stringify({ action: "acknowledge" }) }), params({ id: inc.id }));
    expect(again.status).toBe(409);
    const res = await PATCH(req(`/api/v1/incidents/${inc.id}`, { method: "PATCH", body: JSON.stringify({ action: "resolve" }) }), params({ id: inc.id }));
    expect((await res.json()).data.status).toBe("resolved");
    const detail = await (await getGET(req(`/api/v1/incidents/${inc.id}`), params({ id: inc.id }))).json();
    expect(detail.data.events.map((e: { eventType: string }) => e.eventType)).toEqual(expect.arrayContaining(["created", "acknowledged", "status_changed"]));
    const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, inc.id));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["incident.acknowledge", "incident.resolve"]));
  });

  it("validates input", async () => {
    const inc = await anAcmeIncident();
    signInAs(user("operator@demo.loopmend.dev"));
    const bad = await PATCH(req(`/api/v1/incidents/${inc.id}`, { method: "PATCH", body: JSON.stringify({ action: "explode" }) }), params({ id: inc.id }));
    expect(bad.status).toBe(422);
    expect((await listGET(req("/api/v1/incidents?severity=apocalyptic"), undefined as never)).status).toBe(422);
  });
});

describe("workflows REST API", () => {
  it("returns health stats and paginates executions within the tenant", async () => {
    signInAs(user("viewer@demo.loopmend.dev"));
    const list = await (await wfGET(req("/api/v1/workflows"), undefined as never)).json();
    const wf = list.data.find((w: { externalId: string }) => w.externalId === "wf_crm_contact_sync");
    expect(wf.stats.runs).toBeGreaterThan(50);
    expect(["degraded", "failing"]).toContain(wf.health);

    const page1 = await (await execGET(req(`/api/v1/workflows/${wf.id}/executions?limit=10`), params({ id: wf.id }))).json();
    expect(page1.data).toHaveLength(10);
    const page2 = await (await execGET(req(`/api/v1/workflows/${wf.id}/executions?limit=10&cursor=${page1.meta.nextCursor}`), params({ id: wf.id }))).json();
    expect(page2.data[0].id).not.toBe(page1.data[9].id);
    expect(new Date(page2.data[0].startedAt) <= new Date(page1.data[9].startedAt)).toBe(true);

    signInAs(user("owner@globex.loopmend.dev"));
    expect((await execGET(req(`/api/v1/workflows/${wf.id}/executions`), params({ id: wf.id }))).status).toBe(404);
  });
});

describe("incident service rules", () => {
  it("enforces the state machine and search", async () => {
    const operator = { organizationId: ids.acme, actor: { type: "user" as const, id: user("operator@demo.loopmend.dev") }, role: "operator" as const };
    const { items } = await listIncidents(operator, { view: "active", status: [], severity: [], category: [], limit: 50 });
    const target = items[0];
    await updateIncident(operator, target.id, { action: "dismiss" });
    await expect(updateIncident(operator, target.id, { action: "resolve" })).rejects.toThrow(/cannot move from dismissed to resolved/);
    await updateIncident(operator, target.id, { action: "reopen" });
    const found = await listIncidents(operator, { view: "all", status: [], severity: [], category: [], limit: 5, q: `INC-${target.number}` });
    expect(found.items.map((i) => i.id)).toContain(target.id);
  });
});
