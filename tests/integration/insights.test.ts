import "../support/request-context";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import * as schema from "@schema";
import { createTestDb } from "../support/db";
import { signInAs } from "../support/session";
import { seedDemo } from "@/lib/db/seed";
import "@/lib/db/seed-incidents";
import "@/services/hooks";
import { __setAiProvider } from "@/lib/ai/ai.service";
import { investigateIncident } from "@/services/investigation.service";
import { generatePostmortem, incidentImpact, publicStatus, setStatusPage } from "@/services/insights.service";
import { GET as postmortemGET } from "@/app/api/v1/incidents/[id]/postmortem/route";
import { resetRateLimits } from "@/lib/http/rate-limit";
import type { ServiceContext } from "@/services/context";
import type { Db } from "@/lib/db/client";

let db: Db;
let close: () => Promise<void>;
let ids: Awaited<ReturnType<typeof seedDemo>>;
let operator: ServiceContext;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  ids = await seedDemo(db, Date.now(), { days: 3 });
  operator = { organizationId: ids.acme, actor: { type: "user", id: ids.userIds.get("operator@demo.loopmend.dev")! }, role: "operator" };
  __setAiProvider(null);
});
afterAll(async () => close());

async function anIncident() {
  const [inc] = await db.select().from(schema.incidents).where(eq(schema.incidents.organizationId, ids.acme)).limit(1);
  return inc;
}

describe("postmortems & impact", () => {
  it("builds a blameless postmortem from recorded facts", async () => {
    const inc = await anIncident();
    await investigateIncident(operator, inc.id);
    const { filename, markdown } = await generatePostmortem(operator, inc.id);
    expect(filename).toMatch(/^inc-\d{4}-postmortem\.md$/);
    for (const section of ["## Summary", "## Impact", "## Root cause", "## Recovery", "## Timeline (UTC)", "## What we will do differently"]) expect(markdown).toContain(section);
    expect(markdown).toContain("Acme Logistics (demo)");
    expect(markdown).not.toContain("(demo) (demo data)");
    expect(markdown).toMatch(/Analysis by rules/);
    const impact = await incidentImpact(operator, inc.id);
    expect(impact.runs).toBeGreaterThanOrEqual(impact.failures);
    expect(impact.occurrences).toBe(inc.occurrenceCount);
  });

  it("serves the postmortem as a markdown download and hides other tenants' incidents", async () => {
    const inc = await anIncident();
    signInAs(ids.userIds.get("viewer@demo.loopmend.dev"));
    resetRateLimits();
    const res = await postmortemGET(new NextRequest(`http://localhost/api/v1/incidents/${inc.id}/postmortem`), { params: Promise.resolve({ id: inc.id }) } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    signInAs(ids.userIds.get("owner@globex.loopmend.dev"));
    const other = await postmortemGET(new NextRequest(`http://localhost/api/v1/incidents/${inc.id}/postmortem`), { params: Promise.resolve({ id: inc.id }) } as never);
    expect(other.status).toBe(404);
  });
});

describe("public status page", () => {
  it("is opt-in and exposes aggregate health only", async () => {
    expect(await publicStatus("globex-demo")).toBeNull();
    expect(await publicStatus("does-not-exist")).toBeNull();
    const status = await publicStatus("acme-demo");
    expect(status).not.toBeNull();
    expect(status!.services.length).toBeGreaterThan(3);
    expect(status!.services[0].bars).toHaveLength(30);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toMatch(/HTTP 4\d\d|ECONNRESET|errorMessage|INC-/);
    expect(["operational", "degraded", "major_outage"]).toContain(status!.overall);
  });

  it("can only be toggled by admins", async () => {
    await expect(setStatusPage(operator, true)).rejects.toThrow(/cannot perform org:settings/);
    const owner: ServiceContext = { organizationId: ids.globex, actor: { type: "user", id: ids.userIds.get("owner@globex.loopmend.dev")! }, role: "owner" };
    await setStatusPage(owner, true);
    expect(await publicStatus("globex-demo")).not.toBeNull();
  });
});
