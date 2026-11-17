import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { executions, incidentEvents, incidents, ingestedEvents, organizations, workflows } from "@schema";
import { getDb, type Tx } from "@/lib/db/client";
import { sha256Hex } from "@/lib/security/crypto";
import { classifyError, deriveSeverity, normalizeErrorCode } from "@/lib/incidents/classifier";
import type { CanonicalEvent } from "@/lib/validation/webhook.schema";
import { publishOrgEvent } from "@/lib/realtime/bus";
import { AppError } from "@/lib/utils/errors";
import type { ServiceContext } from "./context";
import { recordAudit } from "./audit.service";

export type IngestResult = {
  outcome: "incident_created" | "incident_recurred" | "execution_recorded" | "duplicate";
  incidentId: string | null;
  incidentNumber: number | null;
  executionId: string;
  status: string | null;
  duplicate: boolean;
};

const CLOSED = ["resolved", "dismissed", "dead_letter"] as const;

export function incidentFingerprint(workflowId: string, errorCode: string, node?: string | null) {
  return sha256Hex(`${workflowId}|${errorCode}|${node ?? ""}`).slice(0, 40);
}

async function upsertWorkflow(tx: Tx, orgId: string, event: CanonicalEvent, integrationId: string | null) {
  const [row] = await tx
    .insert(workflows)
    .values({
      organizationId: orgId,
      integrationId,
      externalId: event.workflow.id,
      name: event.workflow.name,
      // Unknown workflows are treated conservatively until an admin classifies them.
      sideEffectProfile: "non_idempotent",
      lastExecutionAt: new Date(event.occurredAt),
    })
    .onConflictDoUpdate({
      target: [workflows.organizationId, workflows.externalId],
      set: { name: event.workflow.name, lastExecutionAt: new Date(event.occurredAt), updatedAt: new Date() },
    })
    .returning();
  return row;
}

async function upsertExecution(tx: Tx, orgId: string, workflowId: string, event: CanonicalEvent) {
  const occurred = new Date(event.occurredAt);
  const duration = event.execution.durationMs ?? null;
  const startedAt = event.execution.startedAt ? new Date(event.execution.startedAt) : duration ? new Date(occurred.getTime() - duration) : occurred;
  const err = event.execution.error;
  const [row] = await tx
    .insert(executions)
    .values({
      organizationId: orgId,
      workflowId,
      externalId: event.execution.id,
      status: event.execution.status,
      mode: event.execution.mode,
      startedAt,
      finishedAt: occurred,
      durationMs: duration,
      errorCode: err?.code ?? null,
      errorMessage: err?.message ?? null,
      errorNode: err?.node ?? null,
      httpStatus: err?.httpStatus ?? null,
      metadata: { retryOf: event.execution.retryOf ?? null, eventId: event.eventId },
    })
    .onConflictDoUpdate({
      target: [executions.organizationId, executions.externalId],
      set: { status: event.execution.status, finishedAt: occurred },
    })
    .returning();
  return row;
}

/**
 * Idempotent ingestion of a normalized n8n event.
 *  - (organization, eventId) is recorded in `ingested_events` under a unique
 *    index inside the same transaction, so concurrent or retried deliveries of
 *    the same event can never create a second incident.
 *  - Reusing an eventId with a different payload is rejected (409).
 *  - Failures with the same fingerprint (workflow + error signature) while an
 *    incident is still open are correlated as recurrences instead of new incidents.
 */
export async function ingestEvent(ctx: ServiceContext, event: CanonicalEvent, opts: { integrationId?: string | null; payloadHash: string }): Promise<IngestResult> {
  const db = await getDb();
  const orgId = ctx.organizationId;

  const result = await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(ingestedEvents)
      .values({ organizationId: orgId, eventId: event.eventId, eventType: event.event, source: event.source, payloadHash: opts.payloadHash, outcome: "processing" })
      .onConflictDoNothing()
      .returning({ id: ingestedEvents.id });

    if (claimed.length === 0) {
      const [prior] = await tx
        .select()
        .from(ingestedEvents)
        .where(and(eq(ingestedEvents.organizationId, orgId), eq(ingestedEvents.eventId, event.eventId)));
      if (prior.payloadHash !== opts.payloadHash) {
        throw new AppError("CONFLICT", "eventId was already used with a different payload");
      }
      const [inc] = prior.incidentId ? await tx.select().from(incidents).where(eq(incidents.id, prior.incidentId)) : [];
      return {
        outcome: "duplicate",
        duplicate: true,
        incidentId: prior.incidentId,
        incidentNumber: inc?.number ?? null,
        executionId: prior.executionId ?? "",
        status: inc?.status ?? null,
      } satisfies IngestResult;
    }
    const ledgerId = claimed[0].id;

    const wf = await upsertWorkflow(tx, orgId, event, opts.integrationId ?? null);
    const exec = await upsertExecution(tx, orgId, wf.id, event);

    if (event.event === "workflow.execution.succeeded" || event.execution.status === "success") {
      await tx.update(ingestedEvents).set({ outcome: "execution_recorded", executionId: exec.id }).where(eq(ingestedEvents.id, ledgerId));
      return { outcome: "execution_recorded", duplicate: false, incidentId: null, incidentNumber: null, executionId: exec.id, status: null } satisfies IngestResult;
    }

    const err = event.execution.error ?? { message: "Workflow execution failed" };
    const classification = classifyError({ code: err.code, message: err.message, httpStatus: err.httpStatus, node: err.node });
    const errorCode = normalizeErrorCode({ code: err.code, message: err.message, httpStatus: err.httpStatus }, classification.category);
    const fingerprint = incidentFingerprint(wf.id, errorCode, err.node);

    const [open] = await tx
      .select()
      .from(incidents)
      .where(and(eq(incidents.organizationId, orgId), eq(incidents.fingerprint, fingerprint), notInArray(incidents.status, [...CLOSED])))
      .for("update")
      .limit(1);

    let incidentId: string;
    let incidentNumber: number;
    let status: string;
    let outcome: IngestResult["outcome"];

    if (open) {
      const occurrences = open.occurrenceCount + 1;
      const severity = deriveSeverity(classification.category, wf.criticality, occurrences);
      const [updated] = await tx
        .update(incidents)
        .set({
          occurrenceCount: occurrences,
          lastSeenAt: new Date(event.occurredAt),
          executionId: exec.id,
          // Severity only escalates automatically; humans may lower it.
          severity: rank(severity) > rank(open.severity) ? severity : open.severity,
          updatedAt: new Date(),
        })
        .where(eq(incidents.id, open.id))
        .returning();
      await tx.insert(incidentEvents).values({
        organizationId: orgId,
        incidentId: open.id,
        eventType: "recurred",
        actorType: ctx.actor.type,
        metadata: { executionId: exec.id, externalExecutionId: exec.externalId, occurrence: occurrences, eventId: event.eventId },
      });
      incidentId = updated.id;
      incidentNumber = updated.number;
      status = updated.status;
      outcome = "incident_recurred";
    } else {
      const [{ seq }] = await tx
        .update(organizations)
        .set({ incidentSeq: sql`${organizations.incidentSeq} + 1` })
        .where(eq(organizations.id, orgId))
        .returning({ seq: organizations.incidentSeq });
      const severity = deriveSeverity(classification.category, wf.criticality);
      const [created] = await tx
        .insert(incidents)
        .values({
          organizationId: orgId,
          number: seq,
          workflowId: wf.id,
          executionId: exec.id,
          title: `${wf.name}: ${err.message.slice(0, 120)}`,
          severity,
          category: classification.category,
          status: "open",
          fingerprint,
          errorCode,
          errorMessage: err.message,
          firstSeenAt: new Date(event.occurredAt),
          lastSeenAt: new Date(event.occurredAt),
        })
        .returning();
      await tx.insert(incidentEvents).values({
        organizationId: orgId,
        incidentId: created.id,
        eventType: "created",
        actorType: ctx.actor.type,
        metadata: { eventId: event.eventId, executionId: exec.id, classification: { category: classification.category, evidence: classification.evidence }, severity },
      });
      await recordAudit(tx, ctx, {
        action: "incident.created",
        targetType: "incident",
        targetId: created.id,
        metadata: { number: seq, workflow: wf.name, category: classification.category, severity, eventId: event.eventId },
      });
      incidentId = created.id;
      incidentNumber = seq;
      status = created.status;
      outcome = "incident_created";
    }

    await tx.update(ingestedEvents).set({ outcome, incidentId, executionId: exec.id }).where(eq(ingestedEvents.id, ledgerId));
    return { outcome, duplicate: false, incidentId, incidentNumber, executionId: exec.id, status } satisfies IngestResult;
  });

  if (!result.duplicate) {
    publishOrgEvent(orgId, result.incidentId
      ? { type: result.outcome === "incident_created" ? "incident.created" : "incident.updated", id: result.incidentId, summary: `INC-${result.incidentNumber}` }
      : { type: "execution.recorded", id: result.executionId });
  }
  return result;
}

const rank = (s: string) => ["low", "medium", "high", "critical"].indexOf(s);
