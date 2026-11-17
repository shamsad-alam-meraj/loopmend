/**
 * Optional Vercel build hook (package.json "vercel-build").
 * When RUN_MIGRATIONS_ON_BUILD=true and this is a production build, applies
 * migrations before `next build`. The recommended path is the GitHub Actions
 * deploy pipeline (migrate job → deploy), which keeps DDL out of builds.
 */
import { execSync } from "node:child_process";

const run = (cmd: string) => execSync(cmd, { stdio: "inherit", env: process.env });

if (process.env.RUN_MIGRATIONS_ON_BUILD === "true" && process.env.VERCEL_ENV === "production") {
  if (!process.env.DATABASE_URL) {
    console.error("RUN_MIGRATIONS_ON_BUILD=true but DATABASE_URL is not set");
    process.exit(1);
  }
  console.log("› applying database migrations before build");
  run("npm run db:migrate");
} else {
  console.log("› skipping migrations during build (handled by the deploy pipeline)");
}
run("npx next build");
