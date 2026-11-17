import type { InvestigationContext } from "../types";
import { renderContext, SYSTEM_PREAMBLE } from "./shared";

export const CLASSIFY_PROMPT_VERSION = "classify-incident@1";

export function classifyIncidentPrompt(ctx: InvestigationContext) {
  return {
    system: SYSTEM_PREAMBLE,
    prompt: `Classify this workflow failure.
- category: the single best failure class.
- severity: business impact given workflow criticality "${ctx.workflow.criticality}", side effects "${ctx.workflow.sideEffectProfile}", and ${ctx.incident.occurrences} occurrence(s).
- rationale: one or two sentences citing the evidence.

${renderContext(ctx)}`,
  };
}
