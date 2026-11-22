import "server-only";
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import * as schema from "@schema";
import { logger } from "@/lib/utils/logger";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that can run queries: the root db or an open transaction. */
export type Executor = Db | Tx;

type Holder = { db?: Db; ready?: Promise<Db>; kind?: "postgres" | "pglite"; close?: () => Promise<void> };
const g = globalThis as unknown as { __loopmendDb?: Holder };
const holder: Holder = (g.__loopmendDb ??= {});

/** Same rule as features.demoMode(), without importing env (keeps this module light). */
export function demoModeEnabled() {
  const flag = process.env.ENABLE_DEMO_MODE?.trim();
  if (flag) return flag === "true" || flag === "1";
  return process.env.NODE_ENV !== "production";
}

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle", "migrations");

async function connectPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    // Supabase transaction pooler (port 6543) does not support prepared statements.
    prepare: !/:6543\b/.test(url),
  });
  holder.kind = "postgres";
  holder.close = async () => client.end({ timeout: 5 });
  return drizzle(client, { schema }) as unknown as Db;
}

async function connectPglite(dataDir: string | undefined): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir && dataDir !== "memory://") mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir ?? "memory://");
  const db = drizzle(client, { schema });
  // Embedded mode is for local dev/demo/tests: keep it migrated automatically.
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  holder.kind = "pglite";
  holder.close = async () => client.close();
  return db as unknown as Db;
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  let db: Db;
  if (url) {
    db = await connectPostgres(url);
  } else {
    // The embedded database (and its seeded demo accounts) is for local dev and demos only.
    if (process.env.NODE_ENV === "production" && !demoModeEnabled()) {
      throw new Error("DATABASE_URL is required in production (the embedded database is only allowed with ENABLE_DEMO_MODE=true)");
    }
    const dir = process.env.PGLITE_DATA_DIR?.trim() || path.join(process.cwd(), ".data", "pglite");
    logger.info("using embedded PGlite database", { dir });
    db = await connectPglite(dir);
    // Publish the handle before seeding so seed hooks can use services that call getDb().
    holder.db = db;
    if (process.env.NODE_ENV !== "test" && demoModeEnabled()) {
      await import("./seed-hooks");
      const { seedDemoIfEmpty } = await import("./seed");
      try {
        await seedDemoIfEmpty(db);
      } catch (e) {
        logger.error("demo seeding failed", { reason: (e as Error).message });
        holder.db = undefined;
        throw e;
      }
    }
  }
  holder.db = db;
  return db;
}

/** Lazily-initialized shared database handle. */
export function getDb(): Promise<Db> {
  if (holder.db) return Promise.resolve(holder.db);
  holder.ready ??= init().catch((e) => {
    holder.ready = undefined;
    throw e;
  });
  return holder.ready;
}

export function databaseKind() {
  return holder.kind ?? (process.env.DATABASE_URL ? "postgres" : "pglite");
}

/** Test hook: install a specific database instance (e.g. in-memory PGlite). */
export function __setDb(db: Db | undefined) {
  holder.db = db;
  holder.ready = db ? Promise.resolve(db) : undefined;
}

export async function closeDb() {
  await holder.close?.();
  holder.db = undefined;
  holder.ready = undefined;
}

export { schema };
