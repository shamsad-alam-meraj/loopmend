import "server-only";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: optional,
  NEXT_PUBLIC_APP_URL: optional,
  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  DATABASE_URL: optional,
  PGLITE_DATA_DIR: optional,
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: optional,
  N8N_BASE_URL: optional,
  N8N_WEBHOOK_URL: optional,
  N8N_API_KEY: optional,
  N8N_WEBHOOK_SECRET: optional,
  ENCRYPTION_KEY: optional,
  SESSION_SECRET: optional,
  SESSION_SECRET_1: optional,
  CRON_SECRET: optional,
  CRON_SECRET_1: optional,
  SENTRY_DSN: optional,
  ENABLE_DEMO_MODE: optional,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Parsed, validated server environment. Never import from client components. */
export function env(): ServerEnv {
  if (!cached || process.env.NODE_ENV === "test") {
    cached = serverEnvSchema.parse(process.env);
  }
  return cached;
}

const DEV_FALLBACK_SECRET = "dev-only-insecure-secret-do-not-use-in-production-000";

/** Alternate names accepted for hosts where the canonical name is reserved or conflicts (e.g. on Vercel). */
const ALIASES = { SESSION_SECRET: "SESSION_SECRET_1", CRON_SECRET: "CRON_SECRET_1" } as const;

function requireSecret(name: "N8N_WEBHOOK_SECRET" | "SESSION_SECRET" | "CRON_SECRET"): string {
  const alias = name in ALIASES ? ALIASES[name as keyof typeof ALIASES] : undefined;
  const value = env()[name] ?? (alias ? env()[alias] : undefined);
  if (value && value.length >= 32) return value;
  if (env().NODE_ENV === "production") {
    throw new Error(`${name}${alias ? ` (or ${alias})` : ""} must be set to at least 32 characters in production`);
  }
  return value ?? DEV_FALLBACK_SECRET;
}

export const secrets = {
  webhook: () => requireSecret("N8N_WEBHOOK_SECRET"),
  session: () => requireSecret("SESSION_SECRET"),
  cron: () => requireSecret("CRON_SECRET"),
};

export const features = {
  supabaseAuth: () => Boolean(env().NEXT_PUBLIC_SUPABASE_URL && (env().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env().NEXT_PUBLIC_SUPABASE_ANON_KEY)),
  externalDatabase: () => Boolean(env().DATABASE_URL),
  gemini: () => Boolean(env().GEMINI_API_KEY),
  n8n: () => Boolean(env().N8N_WEBHOOK_URL),
  demoMode: () => {
    const flag = env().ENABLE_DEMO_MODE;
    if (flag !== undefined) return flag === "true" || flag === "1";
    return env().NODE_ENV !== "production";
  },
};
