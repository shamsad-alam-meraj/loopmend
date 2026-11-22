import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 3200);
const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(os.tmpdir(), `loopmend-e2e-${Date.now()}`);

/** E2E runs against a production build with a fresh embedded Postgres and seeded demo data. */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/v1/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      PGLITE_DATA_DIR: dataDir,
      DATABASE_URL: "",
      ENABLE_DEMO_MODE: "true",
      // The simulator only posts to a configured URL (never the request Host header).
      // Runtime variable on purpose: NEXT_PUBLIC_* values are inlined at build time.
      LOOPMEND_INTERNAL_URL: `http://127.0.0.1:${PORT}`,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      GEMINI_API_KEY: "",
      N8N_WEBHOOK_URL: "",
      // next start runs with NODE_ENV=production, which requires a real key (test-only value).
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-session-secret-0123456789abcdef0123456789",
      N8N_WEBHOOK_SECRET: process.env.N8N_WEBHOOK_SECRET ?? "e2e-webhook-secret-0123456789abcdef012345678",
      CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789abcdef0123456789abc",
    },
  },
});
