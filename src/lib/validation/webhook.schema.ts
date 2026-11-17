import { z } from "zod";

/** Canonical incident webhook contract (docs §7). */
export const canonicalEventSchema = z.object({
  event: z.enum(["workflow.execution.failed", "workflow.execution.succeeded"]),
  eventId: z.string().min(3).max(128).regex(/^[A-Za-z0-9_\-:.]+$/, "eventId has invalid characters"),
  source: z.literal("n8n"),
  workflow: z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(200) }),
  execution: z.object({
    id: z.string().min(1).max(128),
    status: z.enum(["error", "success", "crashed", "canceled"]),
    durationMs: z.number().int().nonnegative().max(86_400_000).nullable().optional(),
    mode: z.string().max(40).optional(),
    retryOf: z.string().max(128).nullable().optional(),
    startedAt: z.iso.datetime().optional(),
    error: z
      .object({
        code: z.string().max(64).optional(),
        message: z.string().max(2000),
        node: z.string().max(200).optional(),
        httpStatus: z.number().int().min(100).max(599).optional(),
      })
      .optional(),
  }),
  occurredAt: z.iso.datetime(),
});

export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;
