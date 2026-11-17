import "../support/request-context";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "../support/db";
import { signInAs } from "../support/session";
import { seedDemo } from "@/lib/db/seed";
import { GET as analyticsGET } from "@/app/api/v1/analytics/reliability/route";
import { GET as cronRecoveries } from "@/app/api/v1/cron/recoveries/route";
import { GET as cronReport } from "@/app/api/v1/cron/reliability-report/route";
import { GET as streamGET } from "@/app/api/v1/events/stream/route";
import { resetRateLimits } from "@/lib/http/rate-limit";
import { secrets } from "@/lib/env";

let close: () => Promise<void>;
let ids: Awaited<ReturnType<typeof seedDemo>>;

beforeAll(async () => {
  const t = await createTestDb();
  close = t.close;
  ids = await seedDemo(t.db, Date.now(), { days: 8 });
});
afterAll(async () => close());

const req = (url: string, init?: RequestInit) => {
  resetRateLimits();
  return new NextRequest(`http://localhost${url}`, init as never);
};

describe("GET /api/v1/analytics/reliability", () => {
  it("returns SLOs, recovery stats and detects the seeded CRM anomaly", async () => {
    signInAs(ids.userIds.get("viewer@demo.loopmend.dev"));
    const res = await analyticsGET(req("/api/v1/analytics/reliability?days=7"), undefined as never);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.summary.runs).toBeGreaterThan(1000);
    expect(data.daily.length).toBeGreaterThanOrEqual(7);
    const crm = data.workflows.find((w: { name: string }) => w.name === "CRM Contact Sync");
    expect(crm.slo.target).toBe(0.98);
    const flagged = data.anomalies.find((a: { workflowName: string }) => a.workflowName === "CRM Contact Sync");
    expect(flagged.anomalies.map((a: { kind: string }) => a.kind)).toEqual(expect.arrayContaining(["failure_spike", "latency_regression"]));
    // Workflows without injected anomalies stay quiet.
    expect(data.anomalies.map((a: { workflowName: string }) => a.workflowName)).not.toContain("Ops Slack Digest");
  });

  it("requires authentication", async () => {
    signInAs(undefined);
    expect((await analyticsGET(req("/api/v1/analytics/reliability"), undefined as never)).status).toBe(401);
    expect((await streamGET(req("/api/v1/events/stream"))).status).toBe(401);
  });
});

describe("cron endpoints", () => {
  it("reject missing or wrong secrets and accept the right one", async () => {
    expect((await cronRecoveries(req("/api/v1/cron/recoveries"), undefined as never)).status).toBe(401);
    expect((await cronRecoveries(req("/api/v1/cron/recoveries", { headers: { authorization: "Bearer nope" } }), undefined as never)).status).toBe(401);
    const ok = await cronRecoveries(req("/api/v1/cron/recoveries", { headers: { authorization: `Bearer ${secrets.cron()}` } }), undefined as never);
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({ retried: 0, deadLettered: 0 });
    const report = await cronReport(req("/api/v1/cron/reliability-report", { headers: { authorization: `Bearer ${secrets.cron()}` } }), undefined as never);
    const { data } = await report.json();
    expect(data).toHaveLength(2);
    expect(data[0].anomalies.length + data[1].anomalies.length).toBeGreaterThan(0);
  });
});
