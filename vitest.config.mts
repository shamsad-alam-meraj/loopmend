import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside a React Server environment; it is a no-op in tests.
      "server-only": path.resolve(__dirname, "tests/support/server-only.ts"),
      "@schema": path.resolve(__dirname, "drizzle/schema.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    pool: "forks",
    // Each integration file boots its own in-memory Postgres; cap parallelism to keep CI runners stable.
    maxWorkers: 3,
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/services/**", "src/app/api/**"],
      exclude: ["src/lib/supabase/**", "src/lib/db/seed*.ts", "src/lib/db/demo-data.ts"],
      reporter: ["text-summary", "json-summary", "html"],
    },
  },
});
