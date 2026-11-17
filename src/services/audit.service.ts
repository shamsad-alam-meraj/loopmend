import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import { auditLogs } from "@schema";
import type { Executor } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import { authorize, type ServiceContext } from "./context";

export type AuditEntry = {
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

/** Append-only audit record. Call inside the same transaction as the change it describes. */
export async function recordAudit(ex: Executor, ctx: ServiceContext, entry: AuditEntry) {
  await ex.insert(auditLogs).values({
    organizationId: ctx.organizationId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata ?? {},
    requestId: ctx.requestId,
  });
}

export async function listAuditLogs(ctx: ServiceContext, opts: { limit?: number; before?: Date; targetId?: string } = {}) {
  authorize(ctx, "audit:read");
  const db = await getDb();
  const conditions = [eq(auditLogs.organizationId, ctx.organizationId)];
  if (opts.before) conditions.push(lt(auditLogs.createdAt, opts.before));
  if (opts.targetId) conditions.push(eq(auditLogs.targetId, opts.targetId));
  return db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}
