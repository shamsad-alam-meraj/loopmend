import { z } from "zod";
import { categoryEnum, executionStatusEnum, incidentStatusEnum, severityEnum, criticalityEnum, sideEffectEnum } from "@schema";

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(values)));

export const incidentListQuery = z.object({
  status: csv(incidentStatusEnum.enumValues),
  severity: csv(severityEnum.enumValues),
  category: csv(categoryEnum.enumValues),
  workflowId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  view: z.enum(["active", "closed", "all", "dead_letter"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type IncidentListQuery = z.infer<typeof incidentListQuery>;

export const incidentUpdateBody = z.object({
  action: z.enum(["acknowledge", "resolve", "dismiss", "reopen", "assign_self", "unassign"]).optional(),
  severity: z.enum(severityEnum.enumValues).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const executionListQuery = z.object({
  status: csv(executionStatusEnum.enumValues),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const workflowUpdateBody = z.object({
  criticality: z.enum(criticalityEnum.enumValues).optional(),
  sideEffectProfile: z.enum(sideEffectEnum.enumValues).optional(),
  autoRecoveryEnabled: z.boolean().optional(),
  status: z.enum(["active", "inactive", "archived"]).optional(),
});

/** Opaque keyset cursor: base64url("<iso timestamp>|<uuid>"). */
export function encodeCursor(date: Date, id: string) {
  return Buffer.from(`${date.toISOString()}|${id}`).toString("base64url");
}
export function decodeCursor(cursor?: string): { date: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const date = new Date(iso ?? "");
  if (Number.isNaN(date.getTime()) || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { date, id };
}
