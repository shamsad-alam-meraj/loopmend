import { z } from "zod";
import { categoryEnum, recoveryStrategyEnum, severityEnum } from "@schema";

/** Step 1 output: classification. */
export const classificationSchema = z.object({
  category: z.enum(categoryEnum.enumValues),
  severity: z.enum(severityEnum.enumValues),
  rationale: z.string().min(1).max(500),
});
export type AiClassification = z.infer<typeof classificationSchema>;

/**
 * Step 2 output: the AI output contract (docs §8). `strategy` is restricted to
 * the finite allowlist — anything else fails validation and triggers the fallback.
 */
export const investigationSchema = z.object({
  category: z.enum(categoryEnum.enumValues),
  severity: z.enum(severityEnum.enumValues),
  rootCause: z.object({
    summary: z.string().min(5).max(400),
    evidence: z.array(z.string().min(2).max(300)).min(1).max(8),
  }),
  recommendation: z.object({
    strategy: z.enum(recoveryStrategyEnum.enumValues),
    requiresApproval: z.boolean(),
    maxAttempts: z.number().int().min(0).max(10),
    rationale: z.string().max(500).optional(),
  }),
  confidence: z.number().min(0).max(1),
  caveats: z.array(z.string().max(300)).max(5).optional(),
});
export type Investigation = z.infer<typeof investigationSchema>;

/** JSON Schema (OpenAPI subset) handed to the model for structured output. */
export const classificationJsonSchema = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", enum: [...categoryEnum.enumValues] },
    severity: { type: "STRING", enum: [...severityEnum.enumValues] },
    rationale: { type: "STRING" },
  },
  required: ["category", "severity", "rationale"],
} as const;

export const investigationJsonSchema = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", enum: [...categoryEnum.enumValues] },
    severity: { type: "STRING", enum: [...severityEnum.enumValues] },
    rootCause: {
      type: "OBJECT",
      properties: { summary: { type: "STRING" }, evidence: { type: "ARRAY", items: { type: "STRING" } } },
      required: ["summary", "evidence"],
    },
    recommendation: {
      type: "OBJECT",
      properties: {
        strategy: { type: "STRING", enum: [...recoveryStrategyEnum.enumValues] },
        requiresApproval: { type: "BOOLEAN" },
        maxAttempts: { type: "INTEGER" },
        rationale: { type: "STRING" },
      },
      required: ["strategy", "requiresApproval", "maxAttempts"],
    },
    confidence: { type: "NUMBER" },
    caveats: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["category", "severity", "rootCause", "recommendation", "confidence"],
} as const;
