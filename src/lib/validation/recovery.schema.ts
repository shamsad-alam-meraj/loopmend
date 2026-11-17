import { z } from "zod";
import { recoveryStatusEnum, recoveryStrategyEnum } from "@schema";

export const createPlanBody = z.object({
  incidentId: z.uuid(),
  strategy: z.enum(recoveryStrategyEnum.enumValues).optional(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
  investigationId: z.uuid().optional(),
  rationale: z.string().trim().max(500).optional(),
});

export const decisionBody = z.object({ comment: z.string().trim().max(1000).optional() });

export const planListQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",") : []))
    .pipe(z.array(z.enum(recoveryStatusEnum.enumValues))),
  incidentId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const recoveryCallbackBody = z.object({
  attemptId: z.uuid(),
  idempotencyKey: z.string().min(8).max(200),
  status: z.enum(["succeeded", "failed"]),
  executionId: z.string().max(128).optional(),
  message: z.string().max(1000).optional(),
  retryable: z.boolean().optional(),
  durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
});
