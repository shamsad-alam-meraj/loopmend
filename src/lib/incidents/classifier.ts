import type { Category, Criticality, Severity } from "@schema";

export type ErrorSignal = { code?: string | null; message?: string | null; httpStatus?: number | null; node?: string | null };

export type Classification = {
  category: Category;
  /** Whether the failure class is generally transient (safe to retry *if* side effects allow). */
  transient: boolean;
  /** Human-readable evidence that led to the classification. */
  evidence: string[];
};

type Rule = { category: Category; transient: boolean; test: (s: Required<{ [K in keyof ErrorSignal]: string }>, http: number | null) => string | null };

const RULES: Rule[] = [
  { category: "rate_limit", transient: true, test: (s, h) => (h === 429 ? "HTTP status 429" : /rate.?limit|too many requests|quota/i.test(s.message + s.code) ? "Rate limit response detected" : null) },
  {
    category: "authentication",
    transient: false,
    test: (s, h) =>
      h === 401 || h === 403
        ? `HTTP status ${h}`
        : /auth|token (has )?expired|unauthori[sz]ed|forbidden|invalid (api )?key|credential/i.test(s.message + " " + s.code) &&
            !/not found|CONFIG/i.test(s.message + " " + s.code) // a *missing* credential is a configuration problem
          ? "Authentication/credential error in message"
          : null,
  },
  { category: "timeout", transient: true, test: (s, h) => (h === 408 || h === 504 ? `HTTP status ${h}` : /timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT|deadline exceeded/i.test(s.message + " " + s.code) ? "Timeout reported by node" : null) },
  { category: "network", transient: true, test: (s) => (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(s.message + " " + s.code) ? "Network-level error code" : null) },
  { category: "upstream_outage", transient: true, test: (s, h) => (h !== null && h >= 500 && h <= 599 ? `HTTP status ${h} from upstream` : /UPSTREAM_5\d\d|service unavailable|bad gateway/i.test(s.message + " " + s.code) ? "Upstream 5xx response" : null) },
  { category: "validation", transient: false, test: (s, h) => (h === 400 || h === 422 ? `HTTP status ${h}` : /validation|required|invalid (input|value|format)|schema|is not (a )?valid/i.test(s.message + " " + s.code) ? "Input validation failure" : null) },
  { category: "configuration", transient: false, test: (s, h) => (h === 404 ? "HTTP status 404" : /not found|missing|CONFIG|no credentials|undefined (property|variable)/i.test(s.message + " " + s.code) ? "Missing configuration/credential" : null) },
  { category: "resource_exhausted", transient: true, test: (s) => (/out of memory|heap|ENOSPC|disk full|too large|payload too large/i.test(s.message + " " + s.code) ? "Resource exhaustion message" : null) },
  { category: "data_quality", transient: false, test: (s) => (/duplicate key|constraint|unexpected token|cannot read propert|null value/i.test(s.message + " " + s.code) ? "Data/shape error" : null) },
];

/** Deterministic, explainable error classification used at ingestion time and as the AI fallback. */
export function classifyError(signal: ErrorSignal): Classification {
  const s = { code: signal.code ?? "", message: signal.message ?? "", httpStatus: String(signal.httpStatus ?? ""), node: signal.node ?? "" };
  const http = signal.httpStatus ?? extractHttpStatus(s.message);
  for (const rule of RULES) {
    const hit = rule.test(s, http);
    if (hit) return { category: rule.category, transient: rule.transient, evidence: [hit, ...(s.node ? [`Failed node: ${s.node}`] : [])] };
  }
  return { category: "unknown", transient: false, evidence: ["No known error signature matched"] };
}

export function extractHttpStatus(message: string | null | undefined): number | null {
  const m = /\b(?:HTTP|status(?: code)?)[\s:]*([1-5]\d\d)\b/i.exec(message ?? "");
  return m ? Number(m[1]) : null;
}

const BASE: Record<Category, Severity> = {
  rate_limit: "medium",
  authentication: "high",
  network: "medium",
  timeout: "medium",
  validation: "medium",
  upstream_outage: "high",
  configuration: "high",
  data_quality: "medium",
  resource_exhausted: "high",
  unknown: "medium",
};
const ORDER: Severity[] = ["low", "medium", "high", "critical"];

/** Severity = category baseline, raised by workflow criticality and recurrence. */
export function deriveSeverity(category: Category, criticality: Criticality, occurrences = 1): Severity {
  let idx = ORDER.indexOf(BASE[category]);
  if (criticality === "critical") idx += 1;
  if (criticality === "low") idx -= 1;
  if (occurrences >= 5) idx += 1;
  return ORDER[Math.max(0, Math.min(ORDER.length - 1, idx))];
}

export function normalizeErrorCode(signal: ErrorSignal, category: Category): string {
  if (signal.code && /^[A-Z0-9_]{2,64}$/.test(signal.code)) return signal.code;
  const http = signal.httpStatus ?? extractHttpStatus(signal.message);
  if (http) return `HTTP_${http}`;
  return category.toUpperCase();
}
