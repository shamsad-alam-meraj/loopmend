/**
 * Clearly-labeled demo data definitions. Demo login credentials for LOCAL
 * development only (documented in README); demo mode is disabled in
 * production unless ENABLE_DEMO_MODE=true.
 */
import type { Criticality, Role, SideEffectProfile } from "@schema";

export const DEMO_PASSWORD = "loopmend-demo";

export const DEMO_USERS: { email: string; fullName: string; role: Role; org: "acme" | "globex" }[] = [
  { email: "owner@demo.loopmend.dev", fullName: "Olivia Owner", role: "owner", org: "acme" },
  { email: "admin@demo.loopmend.dev", fullName: "Adam Admin", role: "admin", org: "acme" },
  { email: "operator@demo.loopmend.dev", fullName: "Opal Operator", role: "operator", org: "acme" },
  { email: "viewer@demo.loopmend.dev", fullName: "Victor Viewer", role: "viewer", org: "acme" },
  { email: "owner@globex.loopmend.dev", fullName: "Gina Globex", role: "owner", org: "globex" },
];

export const DEMO_ORGS = {
  acme: { name: "Acme Logistics (demo)", slug: "acme-demo" },
  globex: { name: "Globex Retail (demo)", slug: "globex-demo" },
} as const;

export type DemoWorkflow = {
  externalId: string;
  name: string;
  description: string;
  criticality: Criticality;
  sideEffectProfile: SideEffectProfile;
  autoRecoveryEnabled: boolean;
  tags: string[];
  runsPerDay: number;
  baseDurationMs: number;
  failureRate: number;
  errors: { code: string; message: string; node: string; httpStatus?: number; weight: number }[];
};

export const DEMO_WORKFLOWS: DemoWorkflow[] = [
  {
    externalId: "wf_payment_notification",
    name: "Payment Notification",
    description: "Sends payment receipts to customers via the messaging provider.",
    criticality: "high",
    sideEffectProfile: "non_idempotent",
    autoRecoveryEnabled: false,
    tags: ["payments", "notifications"],
    runsPerDay: 48,
    baseDurationMs: 2400,
    failureRate: 0.04,
    errors: [
      { code: "RATE_LIMITED", message: "HTTP 429: Too Many Requests", node: "Send Message", httpStatus: 429, weight: 6 },
      { code: "ETIMEDOUT", message: "Request to messaging API timed out after 30000ms", node: "Send Message", weight: 2 },
    ],
  },
  {
    externalId: "wf_crm_contact_sync",
    name: "CRM Contact Sync",
    description: "Upserts new signups into the CRM every 15 minutes.",
    criticality: "medium",
    sideEffectProfile: "idempotent",
    autoRecoveryEnabled: true,
    tags: ["crm", "sync"],
    runsPerDay: 96,
    baseDurationMs: 5200,
    failureRate: 0.03,
    errors: [
      { code: "AUTH_EXPIRED", message: "HTTP 401: OAuth access token expired", node: "CRM Upsert", httpStatus: 401, weight: 5 },
      { code: "RATE_LIMITED", message: "HTTP 429: API quota exceeded for this minute", node: "CRM Upsert", httpStatus: 429, weight: 2 },
    ],
  },
  {
    externalId: "wf_customer_onboarding",
    name: "Customer Onboarding",
    description: "Provisions accounts and sends welcome sequences for new customers.",
    criticality: "high",
    sideEffectProfile: "non_idempotent",
    autoRecoveryEnabled: false,
    tags: ["onboarding"],
    runsPerDay: 20,
    baseDurationMs: 8800,
    failureRate: 0.05,
    errors: [
      { code: "VALIDATION_ERROR", message: "Field 'email' is required but was empty", node: "Validate Input", weight: 4 },
      { code: "UPSTREAM_503", message: "HTTP 503: Service Unavailable from identity provider", node: "Create Account", httpStatus: 503, weight: 2 },
    ],
  },
  {
    externalId: "wf_dw_export",
    name: "Nightly Warehouse Export",
    description: "Exports the previous day's orders to the data warehouse.",
    criticality: "medium",
    sideEffectProfile: "idempotent",
    autoRecoveryEnabled: true,
    tags: ["data", "batch"],
    runsPerDay: 1,
    baseDurationMs: 184_000,
    failureRate: 0.08,
    errors: [{ code: "ETIMEDOUT", message: "Query timed out after 300s", node: "Extract Orders", weight: 1 }],
  },
  {
    externalId: "wf_invoice_generator",
    name: "Invoice Generator",
    description: "Creates and charges monthly invoices in the billing system.",
    criticality: "critical",
    sideEffectProfile: "financial",
    autoRecoveryEnabled: false,
    tags: ["billing", "payments"],
    runsPerDay: 6,
    baseDurationMs: 6400,
    failureRate: 0.02,
    errors: [{ code: "UPSTREAM_502", message: "HTTP 502: Bad Gateway from billing API", node: "Create Charge", httpStatus: 502, weight: 1 }],
  },
  {
    externalId: "wf_inventory_sync",
    name: "Inventory Sync",
    description: "Pulls stock levels from the warehouse system into the storefront.",
    criticality: "medium",
    sideEffectProfile: "idempotent",
    autoRecoveryEnabled: true,
    tags: ["inventory", "sync"],
    runsPerDay: 72,
    baseDurationMs: 3100,
    failureRate: 0.015,
    errors: [{ code: "ECONNRESET", message: "socket hang up (ECONNRESET)", node: "Fetch Stock", weight: 1 }],
  },
  {
    externalId: "wf_ops_digest",
    name: "Ops Slack Digest",
    description: "Posts a daily summary of operations metrics to Slack.",
    criticality: "low",
    sideEffectProfile: "read_only",
    autoRecoveryEnabled: true,
    tags: ["reporting"],
    runsPerDay: 2,
    baseDurationMs: 1200,
    failureRate: 0.01,
    errors: [{ code: "CONFIG_MISSING", message: "Credential 'Slack Bot' not found", node: "Post to Slack", weight: 1 }],
  },
];

export const GLOBEX_WORKFLOWS: DemoWorkflow[] = [
  {
    externalId: "wf_order_confirmation",
    name: "Order Confirmation",
    description: "Globex: sends order confirmation emails.",
    criticality: "high",
    sideEffectProfile: "non_idempotent",
    autoRecoveryEnabled: false,
    tags: ["orders"],
    runsPerDay: 30,
    baseDurationMs: 1800,
    failureRate: 0.03,
    errors: [{ code: "RATE_LIMITED", message: "HTTP 429: Too Many Requests", node: "Send Email", httpStatus: 429, weight: 1 }],
  },
];

/** Small deterministic PRNG so demo data is reproducible. */
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
