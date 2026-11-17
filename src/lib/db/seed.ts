import "server-only";
import { eq } from "drizzle-orm";
import * as schema from "@schema";
import type { Db } from "./client";
import { hashPassword } from "@/lib/security/password";
import { logger } from "@/lib/utils/logger";
import { DEMO_ORGS, DEMO_PASSWORD, DEMO_USERS, DEMO_WORKFLOWS, GLOBEX_WORKFLOWS, mulberry32, type DemoWorkflow } from "./demo-data";

const DAY = 86_400_000;

type SeedHook = (db: Db, ctx: { orgIds: Record<"acme" | "globex", string> }) => Promise<void>;
const hooks: SeedHook[] = [];
/** Later modules (incidents, recovery) register additional demo seeding steps. */
export function registerSeedHook(hook: SeedHook) {
  hooks.push(hook);
}

function buildExecutions(orgId: string, workflowId: string, wf: DemoWorkflow, now: number, rand: () => number, days: number) {
  const rows: (typeof schema.executions.$inferInsert)[] = [];
  const interval = DAY / wf.runsPerDay;
  let n = 0;
  for (let t = now - days * DAY; t < now - 60_000; t += interval) {
    n++;
    const jitter = (rand() - 0.5) * interval * 0.2;
    const startedAt = new Date(t + jitter);
    // Mild latency drift + noise; CRM sync gets slower and flakier in the last 6h (anomaly for the demo).
    const recent = now - t < 6 * 3_600_000;
    const anomaly = wf.externalId === "wf_crm_contact_sync" && recent;
    const duration = Math.round(wf.baseDurationMs * (0.7 + rand() * 0.6) * (anomaly ? 2.6 : 1));
    const failed = rand() < (anomaly ? 0.35 : wf.failureRate);
    const totalWeight = wf.errors.reduce((s, e) => s + e.weight, 0);
    let pick = rand() * totalWeight;
    const err = wf.errors.find((e) => (pick -= e.weight) < 0) ?? wf.errors[0];
    rows.push({
      organizationId: orgId,
      workflowId,
      externalId: `${wf.externalId}_exec_${n}`,
      status: failed ? "error" : "success",
      mode: wf.runsPerDay <= 2 ? "trigger" : "webhook",
      startedAt,
      finishedAt: new Date(startedAt.getTime() + duration),
      durationMs: duration,
      errorCode: failed ? err.code : null,
      errorMessage: failed ? err.message : null,
      errorNode: failed ? err.node : null,
      httpStatus: failed ? (err.httpStatus ?? null) : null,
      metadata: { demo: true },
    });
  }
  return rows;
}

async function seedOrg(db: Db, key: "acme" | "globex", workflows: DemoWorkflow[], userIds: Map<string, string>, now: number, days: number) {
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: DEMO_ORGS[key].name, slug: DEMO_ORGS[key].slug, isDemo: true })
    .returning();
  for (const u of DEMO_USERS.filter((u) => u.org === key)) {
    await db.insert(schema.memberships).values({ organizationId: org.id, userId: userIds.get(u.email)!, role: u.role });
  }
  const rand = mulberry32(key === "acme" ? 42 : 7);
  for (const wf of workflows) {
    const [row] = await db
      .insert(schema.workflows)
      .values({
        organizationId: org.id,
        externalId: wf.externalId,
        name: wf.name,
        description: wf.description,
        criticality: wf.criticality,
        sideEffectProfile: wf.sideEffectProfile,
        autoRecoveryEnabled: wf.autoRecoveryEnabled,
        tags: wf.tags,
        lastExecutionAt: new Date(now - 120_000),
      })
      .returning();
    await db.insert(schema.workflowVersions).values({ organizationId: org.id, workflowId: row.id, version: 1, definitionHash: `demo-${wf.externalId}-v1` });
    const execs = buildExecutions(org.id, row.id, wf, now, rand, days);
    for (let i = 0; i < execs.length; i += 500) {
      await db.insert(schema.executions).values(execs.slice(i, i + 500));
    }
  }
  return org.id;
}

/** Seeds clearly-labeled demo organizations if the database has none. */
export async function seedDemoIfEmpty(db: Db): Promise<boolean> {
  const existing = await db.select({ id: schema.organizations.id }).from(schema.organizations).limit(1);
  if (existing.length > 0) return false;
  await seedDemo(db);
  return true;
}

export async function seedDemo(db: Db, now = Date.now(), opts: { days?: number } = {}) {
  const days = opts.days ?? 14;
  const started = Date.now();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds = new Map<string, string>();
  for (const u of DEMO_USERS) {
    const [existing] = await db.select().from(schema.profiles).where(eq(schema.profiles.email, u.email));
    const row =
      existing ?? (await db.insert(schema.profiles).values({ email: u.email, fullName: u.fullName, passwordHash }).returning())[0];
    userIds.set(u.email, row.id);
  }
  const acme = await seedOrg(db, "acme", DEMO_WORKFLOWS, userIds, now, days);
  const globex = await seedOrg(db, "globex", GLOBEX_WORKFLOWS, userIds, now, days);
  for (const hook of hooks) await hook(db, { orgIds: { acme, globex } });
  logger.info("demo data seeded", { ms: Date.now() - started });
  return { acme, globex, userIds };
}
