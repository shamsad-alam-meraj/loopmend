import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "@schema";
import { __setDb, type Db } from "@/lib/db/client";

/** Fresh, migrated in-memory Postgres (PGlite) for an integration test file. */
export async function createTestDb(): Promise<{ db: Db; client: PGlite; close: () => Promise<void> }> {
  const client = new PGlite("memory://");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle", "migrations") });
  __setDb(db as unknown as Db);
  return {
    db: db as unknown as Db,
    client,
    close: async () => {
      __setDb(undefined);
      await client.close();
    },
  };
}
