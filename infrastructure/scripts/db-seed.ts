/**
 * Seeds demo data into the configured database (DATABASE_URL or PGlite).
 * Usage: npm run db:seed   (refuses to run in production unless ENABLE_DEMO_MODE=true)
 */
import { closeDb, getDb } from "@/lib/db/client";
import { seedDemoIfEmpty } from "@/lib/db/seed";
import "@/lib/db/seed-hooks";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEMO_MODE !== "true") {
    throw new Error("Refusing to seed demo data in production without ENABLE_DEMO_MODE=true");
  }
  const db = await getDb();
  const seeded = await seedDemoIfEmpty(db);
  console.log(seeded ? "demo data seeded" : "database already has organizations — skipped");
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
