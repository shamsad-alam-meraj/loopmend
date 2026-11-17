import type { InvestigationContext } from "../types";
import type { AiClassification } from "../schemas/investigation.schema";
import { renderContext, SYSTEM_PREAMBLE } from "./shared";

export const INVESTIGATE_PROMPT_VERSION = "investigate-incident@1";

export function investigateIncidentPrompt(ctx: InvestigationContext, classification: AiClassification) {
  return {
    system: SYSTEM_PREAMBLE,
    prompt: `Investigate the probable root cause and recommend ONE recovery strategy.

Preliminary classification: ${classification.category} / ${classification.severity} — ${classification.rationale}

Allowed strategies (choose exactly one):
- retry_execution: single re-run; only for transient failures on idempotent/read-only workflows.
- exponential_backoff: bounded retries with backoff; for rate limits / transient upstream errors.
- refresh_credentials_then_retry: credential/token expiry.
- pause_workflow: stop repeated failures (e.g. sustained outage) to avoid damage.
- notify_owner: needs a human change outside Loopmend (config, data fix).
- manual_review: ambiguous, risky, or non-idempotent/financial/destructive side effects.

Constraints:
- If sideEffectProfile is "financial" or "destructive", requiresApproval MUST be true and do not suggest automatic retries.
- maxAttempts: 0 for non-retry strategies, otherwise 1–5.
- evidence: 2–6 short bullet strings, each traceable to a CONTEXT field.
- confidence: your own estimate between 0 and 1 (it is not calibrated; be conservative).
- caveats: what could make this diagnosis wrong.

${renderContext(ctx)}`,
  };
}
