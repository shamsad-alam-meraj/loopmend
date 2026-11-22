import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@schema";
import { createTestDb } from "../support/db";
import { seedDemo, seedDemoIfEmpty } from "@/lib/db/seed";
import { currentSessionVersion, findUserForSession, revokeSessions } from "@/services/user.service";
import { createIntegration, testIntegration } from "@/services/integration.service";
import { __setDb, type Db } from "@/lib/db/client";
import type { PGlite } from "@electric-sql/pglite";

let db: Db;
let client: PGlite;
let close: () => Promise<void>;
let ids: Awaited<ReturnType<typeof seedDemo>>;

beforeAll(async () => {
  ({ db, client, close } = await createTestDb());
  ids = await seedDemo(db, Date.now(), { days: 2 });
});
afterAll(async () => close());
afterEach(() => vi.unstubAllEnvs());

describe("security regressions", () => {
  it("revokes local sessions on sign-out", async () => {
    const id = ids.userIds.get("operator@demo.loopmend.dev")!;
    const v = await currentSessionVersion(id);
    expect(await findUserForSession(id, v)).not.toBeNull();
    await revokeSessions(id);
    expect(await findUserForSession(id, v)).toBeNull();
    expect(await findUserForSession(id, v + 1)).not.toBeNull();
  });

  it("never seeds demo accounts in production without demo mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEMO_MODE", "");
    const fresh = await createTestDb();
    expect(await seedDemoIfEmpty(fresh.db)).toBe(false);
    expect(await fresh.db.select().from(schema.profiles)).toHaveLength(0);
    await fresh.close();
    __setDb(db); // closing the second database detaches the shared handle
  });

  it("does not leak network details or follow redirects when testing an integration (SSRF)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const admin = { organizationId: ids.acme, actor: { type: "user" as const, id: ids.userIds.get("admin@demo.loopmend.dev")! }, role: "admin" as const };
    await expect(createIntegration(admin, { name: "internal", baseUrl: "http://127.0.0.1:5678", apiKey: "k" })).rejects.toThrow(/https/);
    const { integration } = await createIntegration(admin, { name: "metadata", baseUrl: "https://169.254.169.254", apiKey: "k" });
    const r = await testIntegration(admin, integration.id);
    expect(r).toEqual({ ok: false, message: "Could not reach the n8n API at that URL" });
  });

  it("hardens the SECURITY DEFINER search_path", async () => {
    const res = await client.query<{ cfg: string[] }>("select proconfig as cfg from pg_proc where proname = 'lm_is_member'");
    expect(res.rows[0].cfg.join(",")).toContain("pg_temp");
    const [{ v }] = (await db.select({ v: schema.profiles.sessionVersion }).from(schema.profiles).where(eq(schema.profiles.email, "viewer@demo.loopmend.dev")));
    expect(v).toBe(0);
  });
});
