/**
 * Applies reviewed Drizzle migrations to DATABASE_URL (Supabase/Postgres).
 * Usage: npm run db:migrate
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL not set — embedded PGlite migrates automatically on startup. Nothing to do.");
    return;
  }
  const client = postgres(url, { max: 1, prepare: false });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle", "migrations") });
    console.log("migrations applied");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
