import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { executions, incidentEvents, incidents, profiles, workflows, type IncidentStatus, type Severity } from "@schema";
import { getDb, type Executor } from "@/lib/db/client";
import { AppError } from "@/lib/utils/errors";
import { ACTIVE_STATUSES, CLOSED_STATUSES, canTransition, MANUAL_ACTIONS, type ManualAction } from "@/lib/incidents/state";
import { decodeCursor, encodeCursor, type IncidentListQuery } from "@/lib/validation/query.schema";
import { publishOrgEvent } from "@/lib/realtime/bus";
import { authorize, type ServiceContext } from "./context";
import { recordAudit } from "./audit.service";

export async function listIncidents(ctx: ServiceContext, query: IncidentListQuery) {
  authorize(ctx, "incident:read");
  const db = await getDb();
  const where: SQL[] = [eq(incidents.organizationId, ctx.organizationId)];
  const statuses =
    query.status.length > 0
      ? query.status
      : query.view === "closed"
        ? CLOSED_STATUSES
        : query.view === "dead_letter"
          ? (["dead_letter"] as IncidentStatus[])
          : query.view === "all"
            ? []
            : ACTIVE_STATUSES;
  if (statuses.length) where.push(inArray(incidents.status, statuses));
  if (query.severity.length) where.push(inArray(incidents.severity, query.severity));
  if (query.category.length) where.push(inArray(incidents.category, query.category));
  if (query.workflowId) where.push(eq(incidents.workflowId, query.workflowId));
  if (query.q) {
    const term = `%${query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const asNumber = Number(query.q.replace(/^inc-?/i, ""));
    where.push(or(ilike(incidents.title, term), ilike(incidents.errorMessage, term), ...(Number.isInteger(asNumber) && asNumber > 0 ? [eq(incidents.number, asNumber)] : []))!);
  }
  const cursor = decodeCursor(query.cursor);
  if (cursor) where.push(or(lt(incidents.lastSeenAt, cursor.date), and(eq(incidents.lastSeenAt, cursor.date), lt(incidents.id, cursor.id)))!);

  const rows = await db
    .select({ incident: incidents, workflowName: workflows.name, assigneeEmail: profiles.email })
    .from(incidents)
    .innerJoin(workflows, eq(incidents.workflowId, workflows.id))
    .leftJoin(profiles, eq(incidents.assigneeId, profiles.id))
    .where(and(...where))
    .orderBy(desc(incidents.lastSeenAt), desc(incidents.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r.incident, workflowName: r.workflowName, assigneeEmail: r.assigneeEmail })),
    nextCursor: hasMore && last ? encodeCursor(last.incident.lastSeenAt, last.incident.id) : null,
  };
}

export async function getIncidentCounts(ctx: ServiceContext) {
  authorize(ctx, "incident:read");
  const db = await getDb();
  const rows = await db
    .select({ status: incidents.status, severity: incidents.severity, n: count() })
    .from(incidents)
    .where(eq(incidents.organizationId, ctx.organizationId))
    .groupBy(incidents.status, incidents.severity);
  const byStatus: Partial<Record<IncidentStatus, number>> = {};
  let activeCritical = 0;
  let active = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
    if (ACTIVE_STATUSES.includes(r.status)) {
      active += r.n;
      if (r.severity === "critical" || r.severity === "high") activeCritical += r.n;
    }
  }
  return { byStatus, active, activeHighOrCritical: activeCritical };
}

/** Loads an incident scoped to the caller's organization (404 for other tenants). */
export async function getIncident(ctx: ServiceContext, id: string) {
  authorize(ctx, "incident:read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND", "Incident not found");
  const db = await getDb();
  const [row] = await db
    .select({ incident: incidents, workflow: workflows, execution: executions, assignee: { id: profiles.id, email: profiles.email, fullName: profiles.fullName } })
    .from(incidents)
    .innerJoin(workflows, eq(incidents.workflowId, workflows.id))
    .leftJoin(executions, eq(incidents.executionId, executions.id))
    .leftJoin(profiles, eq(incidents.assigneeId, profiles.id))
    .where(and(eq(incidents.id, id), eq(incidents.organizationId, ctx.organizationId)));
  if (!row) throw new AppError("NOT_FOUND", "Incident not found");
  const events = await db
    .select({ event: incidentEvents, actorEmail: profiles.email })
    .from(incidentEvents)
    .leftJoin(profiles, eq(incidentEvents.actorId, profiles.id))
    .where(eq(incidentEvents.incidentId, id))
    .orderBy(asc(incidentEvents.createdAt));
  return { ...row, events: events.map((e) => ({ ...e.event, actorEmail: e.actorEmail })) };
}

/** Status change used by system flows (investigation, recovery) inside their own transactions. */
export async function transitionIncident(
  ex: Executor,
  ctx: ServiceContext,
  incidentId: string,
  to: IncidentStatus,
  meta: Record<string, unknown> = {},
) {
  const [current] = await ex
    .select()
    .from(incidents)
    .where(and(eq(incidents.id, incidentId), eq(incidents.organizationId, ctx.organizationId)))
    .for("update");
  if (!current) throw new AppError("NOT_FOUND", "Incident not found");
  if (current.status === to) return current;
  if (!canTransition(current.status, to)) {
    throw new AppError("CONFLICT", `Incident cannot move from ${current.status} to ${to}`);
  }
  const now = new Date();
  const [updated] = await ex
    .update(incidents)
    .set({
      status: to,
      updatedAt: now,
      resolvedAt: to === "resolved" ? now : to === "open" ? null : current.resolvedAt,
      acknowledgedAt: current.acknowledgedAt ?? (ctx.actor.type === "user" ? now : null),
    })
    .where(eq(incidents.id, incidentId))
    .returning();
  await ex.insert(incidentEvents).values({
    organizationId: ctx.organizationId,
    incidentId,
    eventType: "status_changed",
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    metadata: { from: current.status, to, ...meta },
  });
  publishOrgEvent(ctx.organizationId, { type: "incident.updated", id: incidentId, summary: `INC-${current.number} → ${to}` });
  return updated;
}

/** Human-initiated incident updates (acknowledge, assign, resolve, dismiss, reopen, severity). */
export async function updateIncident(ctx: ServiceContext, id: string, input: { action?: ManualAction; severity?: Severity; note?: string }) {
  authorize(ctx, "incident:update");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(incidents)
      .where(and(eq(incidents.id, id), eq(incidents.organizationId, ctx.organizationId)))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND", "Incident not found");
    let result = current;
    const event = async (eventType: string, metadata: Record<string, unknown>) =>
      tx.insert(incidentEvents).values({ organizationId: ctx.organizationId, incidentId: id, eventType, actorType: "user", actorId: ctx.actor.id, metadata });

    if (input.action === "acknowledge") {
      if (current.acknowledgedAt) throw new AppError("CONFLICT", "Incident is already acknowledged");
      [result] = await tx.update(incidents).set({ acknowledgedAt: new Date(), updatedAt: new Date() }).where(eq(incidents.id, id)).returning();
      await event("acknowledged", { note: input.note });
    } else if (input.action === "assign_self" || input.action === "unassign") {
      const assigneeId = input.action === "assign_self" ? ctx.actor.id : null;
      [result] = await tx.update(incidents).set({ assigneeId, updatedAt: new Date() }).where(eq(incidents.id, id)).returning();
      await event(assigneeId ? "assigned" : "unassigned", { assigneeId });
    } else if (input.action) {
      const to = MANUAL_ACTIONS[input.action];
      result = await transitionIncident(tx, ctx, id, to, { note: input.note, manual: true });
    }
    if (input.severity && input.severity !== result.severity) {
      const from = result.severity;
      [result] = await tx.update(incidents).set({ severity: input.severity, updatedAt: new Date() }).where(eq(incidents.id, id)).returning();
      await event("severity_changed", { from, to: input.severity, note: input.note });
    }
    if (!input.action && !input.severity && input.note) await event("note", { note: input.note });

    await recordAudit(tx, ctx, {
      action: `incident.${input.action ?? (input.severity ? "severity_changed" : "noted")}`,
      targetType: "incident",
      targetId: id,
      metadata: { number: current.number, from: current.status, to: result.status, severity: input.severity, note: input.note },
    });
    publishOrgEvent(ctx.organizationId, { type: "incident.updated", id, summary: `INC-${current.number}` });
    return result;
  });
}

/** Prior incidents for the same workflow / fingerprint — evidence for investigations. */
export async function findRelatedIncidents(ctx: ServiceContext, incident: { id: string; workflowId: string; fingerprint: string }, limit = 5) {
  const db = await getDb();
  return db
    .select({ id: incidents.id, number: incidents.number, title: incidents.title, category: incidents.category, status: incidents.status, resolvedAt: incidents.resolvedAt, createdAt: incidents.createdAt, sameSignature: sql<boolean>`${incidents.fingerprint} = ${incident.fingerprint}` })
    .from(incidents)
    .where(and(eq(incidents.organizationId, ctx.organizationId), eq(incidents.workflowId, incident.workflowId), sql`${incidents.id} <> ${incident.id}`))
    .orderBy(desc(incidents.createdAt))
    .limit(limit);
}
