import type { Category } from "@schema";

/** Curated remediation checklists per failure category, shown next to every incident. */
export const RUNBOOKS: Record<Category, { title: string; steps: string[] }> = {
  rate_limit: {
    title: "Rate limit exceeded",
    steps: [
      "Confirm the 429 source in the failed node and the provider's quota dashboard.",
      "Prefer backoff with jitter over immediate retries; respect Retry-After if present.",
      "Reduce concurrency or batch size in the n8n node (Split In Batches / wait nodes).",
      "If sustained, request a quota increase or spread schedules across the hour.",
    ],
  },
  authentication: {
    title: "Credential rejected",
    steps: [
      "Check whether the OAuth token expired or the API key was rotated/revoked.",
      "Re-authorize the n8n credential; verify required scopes are still granted.",
      "Retry once after refresh. Repeated 401/403 means a permission change, not a transient error.",
      "Rotate any credential that may have been exposed in logs.",
    ],
  },
  network: {
    title: "Network failure",
    steps: [
      "Check DNS resolution and egress from the n8n host (firewall, security lists).",
      "Look for provider status incidents in the same window.",
      "Retry with backoff if the workflow is idempotent; otherwise verify side effects first.",
    ],
  },
  timeout: {
    title: "Operation timed out",
    steps: [
      "Compare p95 latency with the 7-day baseline on the workflow page.",
      "Check whether the payload or query size grew (pagination, date ranges).",
      "Raise node timeouts only with a clear upper bound; prefer smaller batches.",
      "Verify whether the timed-out request completed upstream before retrying.",
    ],
  },
  validation: {
    title: "Invalid input data",
    steps: [
      "Inspect the failing item in the n8n execution (not stored in Loopmend).",
      "Fix the upstream data or add an IF/validation node that routes bad items aside.",
      "Do not retry unchanged input: it will fail again.",
    ],
  },
  upstream_outage: {
    title: "Upstream service errors",
    steps: [
      "Check the provider's status page; correlate with other workflows calling it.",
      "Pause non-idempotent workflows during sustained 5xx to avoid partial side effects.",
      "Resume and replay with backoff once the provider recovers.",
    ],
  },
  configuration: {
    title: "Missing configuration",
    steps: [
      "Verify referenced credentials, environment variables and node parameters exist in this n8n instance.",
      "Check for recent workflow edits (workflow version history).",
      "Fix in n8n, then re-run manually. Automated retries cannot fix configuration.",
    ],
  },
  data_quality: {
    title: "Unexpected data shape",
    steps: [
      "Compare the failing item's shape with the expected schema; look for nulls/duplicates.",
      "Add defensive mapping or deduplication before the failing node.",
      "Backfill affected records after fixing, using idempotent upserts.",
    ],
  },
  resource_exhausted: {
    title: "Resource exhausted",
    steps: [
      "Check memory/disk on the n8n host (docker stats, df -h).",
      "Process large payloads in batches; avoid holding full datasets in memory.",
      "Consider increasing execution data pruning in n8n settings.",
    ],
  },
  unknown: {
    title: "Unclassified failure",
    steps: [
      "Open the execution in n8n and read the full error and stack.",
      "Run an investigation to gather correlated evidence.",
      "Hand off via manual review if the cause stays unclear.",
    ],
  },
};
