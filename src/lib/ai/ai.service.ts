import "server-only";
import type { ZodType } from "zod";
import { logger } from "@/lib/utils/logger";
import { GeminiProvider } from "./providers/gemini";
import { RULES_ENGINE, rulesClassify, rulesInvestigate } from "./providers/rules";
import { classifyIncidentPrompt, CLASSIFY_PROMPT_VERSION } from "./prompts/classify-incident";
import { investigateIncidentPrompt, INVESTIGATE_PROMPT_VERSION } from "./prompts/investigate-incident";
import {
  classificationJsonSchema,
  classificationSchema,
  investigationJsonSchema,
  investigationSchema,
  type AiClassification,
  type Investigation,
} from "./schemas/investigation.schema";
import { AiProviderError, type AiProvider, type InvestigationContext } from "./types";

export type InvestigationRun = {
  result: Investigation;
  provider: string;
  model: string;
  promptVersion: string;
  usedFallback: boolean;
  error: string | null;
  latencyMs: number;
};

let providerOverride: AiProvider | null | undefined;
/** Test hook. `null` forces the rules engine. */
export function __setAiProvider(p: AiProvider | null | undefined) {
  providerOverride = p;
}

export function getAiProvider(): AiProvider | null {
  if (providerOverride !== undefined) return providerOverride;
  const key = process.env.GEMINI_API_KEY?.trim();
  return key ? new GeminiProvider(key, process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash") : null;
}

const MAX_ATTEMPTS = 2;
const RETRY_STRATEGIES: string[] = ["retry_execution", "exponential_backoff", "refresh_credentials_then_retry"];
const TIMEOUT_MS = 20_000;

async function callStructured<T>(provider: AiProvider, req: { system: string; prompt: string }, jsonSchema: unknown, schema: ZodType<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { text } = await provider.generateJson({ ...req, schema: jsonSchema, timeoutMs: TIMEOUT_MS });
      let parsed: unknown;
      try {
        parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        throw new AiProviderError("Model returned invalid JSON", true);
      }
      const valid = schema.safeParse(parsed);
      if (!valid.success) {
        throw new AiProviderError(`Model output failed validation: ${valid.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).slice(0, 3).join("; ")}`, true);
      }
      return valid.data;
    } catch (e) {
      lastError = e;
      const retryable = e instanceof AiProviderError ? e.retryable : true;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 400 * attempt + Math.random() * 200));
    }
  }
  throw lastError;
}

/**
 * Deterministic guardrails applied to ANY engine's output. AI output is
 * advisory; these rules are not negotiable by the model.
 */
export function applySafetyGuards(result: Investigation, ctx: InvestigationContext): Investigation {
  const out = structuredClone(result);
  const risky = ctx.workflow.sideEffectProfile === "financial" || ctx.workflow.sideEffectProfile === "destructive";
  const retrying = RETRY_STRATEGIES.includes(out.recommendation.strategy);
  if (risky && retrying) {
    out.recommendation = { strategy: "manual_review", requiresApproval: true, maxAttempts: 0, rationale: `Overridden by policy: ${ctx.workflow.sideEffectProfile} workflows are never retried automatically` };
    out.caveats = [...(out.caveats ?? []), "Recommendation overridden by side-effect policy"];
  }
  if (risky) out.recommendation.requiresApproval = true;
  // Re-evaluate after any override: only retry-type strategies get attempts (1–5).
  const retriesNow = RETRY_STRATEGIES.includes(out.recommendation.strategy);
  out.recommendation.maxAttempts = retriesNow ? Math.min(Math.max(out.recommendation.maxAttempts, 1), 5) : 0;
  out.confidence = Math.min(1, Math.max(0, out.confidence));
  return out;
}

/** Two-step investigation (classify → investigate) with retry and rules fallback. */
export async function runInvestigation(ctx: InvestigationContext): Promise<InvestigationRun> {
  const started = Date.now();
  const provider = getAiProvider();
  if (provider) {
    try {
      const classification = await callStructured<AiClassification>(provider, classifyIncidentPrompt(ctx), classificationJsonSchema, classificationSchema);
      const result = await callStructured<Investigation>(provider, investigateIncidentPrompt(ctx, classification), investigationJsonSchema, investigationSchema);
      return {
        result: applySafetyGuards(result, ctx),
        provider: provider.name,
        model: provider.model,
        promptVersion: `${CLASSIFY_PROMPT_VERSION}+${INVESTIGATE_PROMPT_VERSION}`,
        usedFallback: false,
        error: null,
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn("AI provider failed; using rules fallback", { provider: provider.name, reason: message });
      const result = rulesInvestigate(ctx, rulesClassify(ctx));
      return {
        result: applySafetyGuards(result, ctx),
        provider: RULES_ENGINE.name,
        model: RULES_ENGINE.model,
        promptVersion: RULES_ENGINE.version,
        usedFallback: true,
        error: `${provider.name}: ${message}`,
        latencyMs: Date.now() - started,
      };
    }
  }
  const result = rulesInvestigate(ctx, rulesClassify(ctx));
  return { result: applySafetyGuards(result, ctx), provider: RULES_ENGINE.name, model: RULES_ENGINE.model, promptVersion: RULES_ENGINE.version, usedFallback: false, error: null, latencyMs: Date.now() - started };
}
