import type { Category, Criticality, Severity, SideEffectProfile } from "@schema";

/** Sanitized, bounded context given to an investigation engine. No raw payloads or secrets. */
export type InvestigationContext = {
  incident: {
    ref: string;
    title: string;
    errorCode: string | null;
    errorMessage: string | null;
    failedNode: string | null;
    httpStatus: number | null;
    preliminaryCategory: Category;
    preliminarySeverity: Severity;
    occurrences: number;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  workflow: { name: string; criticality: Criticality; sideEffectProfile: SideEffectProfile; autoRecoveryEnabled: boolean };
  recentExecutions: { status: string; durationMs: number | null; errorCode: string | null; startedAt: string }[];
  executionStats: { window: string; runs: number; failures: number; p95Ms: number | null; baselineP95Ms: number | null };
  relatedIncidents: { ref: string; category: string; status: string; sameSignature: boolean; resolution?: string | null }[];
};

export type GenerateJsonArgs = { system: string; prompt: string; schema: unknown; timeoutMs: number; temperature?: number };

/** A model provider. Swap Gemini for another vendor by implementing this. */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generateJson(args: GenerateJsonArgs): Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
