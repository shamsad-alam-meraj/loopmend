import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@schema";
import { createTestDb } from "../support/db";
import { seedDemo } from "@/lib/db/seed";
import type { Db } from "@/lib/db/client";
import type { PGlite } from "@electric-sql/pglite";

let db: Db;
let client: PGlite;
let close: () => Promise<void>;
let ids: Awaited<ReturnType<typeof seedDemo>>;

beforeAll(async () => {
  ({ db, client, close } = await createTestDb());
  ids = await seedDemo(db, Date.parse("2026-11-17T10:00:00Z"), { days: 3 });
});
afterAll(async () => close());

describe("schema & seed", () => {
  it("seeds two isolated demo organizations with executions", async () => {
    const orgs = await db.select().from(schema.organizations);
    expect(orgs).toHaveLength(2);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.executions)
      .where(eq(schema.executions.organizationId, ids.acme));
    expect(count).toBeGreaterThan(500);
  });

  it("enforces org-scoped unique external ids", async () => {
    const [wf] = await db.select().from(schema.workflows).where(eq(schema.workflows.organizationId, ids.acme)).limit(1);
    await expect(
      db.insert(schema.workflows).values({ organizationId: ids.acme, externalId: wf.externalId, name: "dup" }),
    ).rejects.toThrow();
    // The same external id in another org is fine.
    await db.insert(schema.workflows).values({ organizationId: ids.globex, externalId: wf.externalId, name: "other tenant" });
  });

  it("keeps audit logs append-only", async () => {
    const [row] = await db
      .insert(schema.auditLogs)
      .values({ organizationId: ids.acme, actorType: "system", action: "test.created" })
      .returning();
    await expect(db.update(schema.auditLogs).set({ action: "tampered" }).where(eq(schema.auditLogs.id, row.id))).rejects.toThrow();
    await expect(db.delete(schema.auditLogs).where(eq(schema.auditLogs.id, row.id))).rejects.toThrow();
  });
});

describe("row level security", () => {
  async function asUser(userId: string, query: string): Promise<unknown[]> {
    return client.transaction(async (tx) => {
      await tx.query("SET LOCAL ROLE authenticated");
      await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      const res = await tx.query(query);
      return res.rows;
    });
  }

  it("lets members read only their own organization's data", async () => {
    const acmeOwner = ids.userIds.get("owner@demo.loopmend.dev")!;
    const globexOwner = ids.userIds.get("owner@globex.loopmend.dev")!;

    const acmeOrgs = (await asUser(acmeOwner, "select id from organizations")) as { id: string }[];
    expect(acmeOrgs.map((o) => o.id)).toEqual([ids.acme]);

    const globexWfs = (await asUser(globexOwner, "select distinct organization_id from workflows")) as { organization_id: string }[];
    expect(globexWfs.map((w) => w.organization_id)).toEqual([ids.globex]);

    const leaked = await asUser(globexOwner, `select id from executions where organization_id = '${ids.acme}' limit 1`);
    expect(leaked).toHaveLength(0);
  });

  it("denies anonymous / unknown users and client-side writes", async () => {
    const none = await asUser("00000000-0000-0000-0000-000000000000", "select id from incidents");
    expect(none).toHaveLength(0);
    const acmeOwner = ids.userIds.get("owner@demo.loopmend.dev")!;
    await expect(
      asUser(acmeOwner, `update workflows set name = 'hacked' where organization_id = '${ids.acme}' returning id`),
    ).rejects.toThrow();
  });

  it("never exposes encrypted integration config to client roles", async () => {
    const admin = ids.userIds.get("admin@demo.loopmend.dev")!;
    await expect(asUser(admin, "select encrypted_config from integrations")).rejects.toThrow(/permission denied/);
  });
});
