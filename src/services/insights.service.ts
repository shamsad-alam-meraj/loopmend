import "server-only";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { aiInvestigations, approvals, auditLogs, executions, incidentEvents, incidents, organizations, profiles, recoveryAttempts, recoveryPlans, workflows } from "@schema";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/utils/errors";
import { RUNBOOKS } from "@/lib/incidents/runbooks";
import { STRATEGY_INFO } from "@/lib/recovery/policy";
import type { Investigation } from "@/lib/ai/schemas/investigation.schema";
import { formatDateTime, formatDuration, titleCase } from "@/lib/utils/format";
import { authorize, type ServiceContext } from "./context";
import { recordAudit } from "./audit.service";

async function loadIncident(ctx: ServiceContext, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND", "Incident not found");
  const db = await getDb();
  const [row] = await db
    .select({ incident: incidents, workflow: workflows })
    .from(incidents)
    .innerJoin(workflows, eq(incidents.workflowId, workflows.id))
    .where(and(eq(incidents.id, id), eq(incidents.organizationId, ctx.organizationId)));
  if (!row) throw new AppError("NOT_FOUND", "Incident not found");
  return row;
}

/** Impact of an incident on its workflow while it was (or is) active. */
export async function incidentImpact(ctx: ServiceContext, incidentId: string) {
  authorize(ctx, "incident:read");
  const { incident, workflow } = await loadIncident(ctx, incidentId);
  const db = await getDb();
  const end = incident.resolvedAt ?? new Date();
  const [w] = await db
    .select({
      runs: sql<number>`count(*)::int`,
      failures: sql<number>`count(*) filter (where ${executions.status} in ('error','crashed'))::int`,
      matching: sql<number>`count(*) filter (where ${executions.errorCode} is not distinct from ${incident.errorCode} and ${executions.status} = 'error')::int`,
    })
    .from(executions)
    .where(and(eq(executions.workflowId, workflow.id), gte(executions.startedAt, incident.firstSeenAt), lte(executions.startedAt, end)));
  const openMs = end.getTime() - incident.firstSeenAt.getTime();
  const perHour = openMs > 0 ? (incident.occurrenceCount / openMs) * 3_600_000 : null;
  return {
    windowStart: incident.firstSeenAt,
    windowEnd: end,
    openMs,
    runs: w.runs,
    failures: w.failures,
    failureRate: w.runs ? w.failures / w.runs : null,
    occurrences: incident.occurrenceCount,
    occurrencesPerHour: perHour,
    criticality: workflow.criticality,
    sideEffectProfile: workflow.sideEffectProfile,
  };
}

/** Blameless postmortem in Markdown, assembled from the incident's recorded facts. */
export async function generatePostmortem(ctx: ServiceContext, incidentId: string): Promise<{ filename: string; markdown: string }> {
  authorize(ctx, "incident:read");
  const db = await getDb();
  const { incident: i, workflow: w } = await loadIncident(ctx, incidentId);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId));
  const [impact, events, [inv], plans, audit] = await Promise.all([
    incidentImpact(ctx, incidentId),
    db.select({ e: incidentEvents, email: profiles.email }).from(incidentEvents).leftJoin(profiles, eq(incidentEvents.actorId, profiles.id)).where(eq(incidentEvents.incidentId, incidentId)).orderBy(asc(incidentEvents.createdAt)),
    db.select().from(aiInvestigations).where(and(eq(aiInvestigations.incidentId, incidentId), eq(aiInvestigations.status, "completed"))).orderBy(desc(aiInvestigations.createdAt)).limit(1),
    db.select().from(recoveryPlans).where(eq(recoveryPlans.incidentId, incidentId)).orderBy(asc(recoveryPlans.createdAt)),
    db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, ctx.organizationId), eq(auditLogs.targetId, incidentId))).orderBy(asc(auditLogs.createdAt)),
  ]);
  const ref = `INC-${String(i.number).padStart(4, "0")}`;
  const d = inv?.diagnosis as unknown as Investigation | undefined;
  const runbook = RUNBOOKS[i.category];

  const planSections: string[] = [];
  for (const p of plans) {
    const [attempts, decisions] = await Promise.all([
      db.select().from(recoveryAttempts).where(eq(recoveryAttempts.recoveryPlanId, p.id)).orderBy(asc(recoveryAttempts.attemptNumber)),
      db.select({ a: approvals, email: profiles.email }).from(approvals).innerJoin(profiles, eq(approvals.decidedBy, profiles.id)).where(eq(approvals.recoveryPlanId, p.id)),
    ]);
    planSections.push(
      [
        `### ${STRATEGY_INFO[p.strategy].label} — ${titleCase(p.status)}`,
        `- Risk: **${p.riskLevel}** · approval required: ${p.requiresApproval ? "yes" : "no (policy auto-approved)"} · attempts ${p.attemptsUsed}/${p.maxAttempts}`,
        ...decisions.map(({ a, email }) => `- ${a.decision === "approved" ? "Approved" : "Rejected"} by ${email} at ${formatDateTime(a.createdAt)}${a.comment ? ` — “${a.comment}”` : ""}`),
        ...attempts.map((a) => `- Attempt #${a.attemptNumber}: **${a.status}** (${formatDuration(a.durationMs)}) — ${String((a.result as { message?: string }).message ?? a.error ?? "")} · idempotency key \`${a.idempotencyKey}\``),
        ...(p.deadLetterReason ? [`- Dead-lettered: ${p.deadLetterReason}`] : []),
      ].join("\n"),
    );
  }

  const markdown = `# Postmortem: ${ref} — ${w.name}

> Blameless postmortem generated by Loopmend from recorded events on ${formatDateTime(new Date())}.
> Organization: ${org.name}${org.isDemo && !/demo/i.test(org.name) ? " (demo data)" : ""}. Review and edit before sharing.

## Summary
| | |
|---|---|
| Status | ${titleCase(i.status)} |
| Severity | ${i.severity} |
| Category | ${titleCase(i.category)} |
| Workflow | ${w.name} (${w.criticality} criticality, ${titleCase(w.sideEffectProfile)}) |
| First seen | ${formatDateTime(i.firstSeenAt)} |
| ${i.resolvedAt ? "Resolved" : "Last seen"} | ${formatDateTime(i.resolvedAt ?? i.lastSeenAt)} |
| Duration | ${formatDuration(impact.openMs)} |

**Error:** \`${i.errorCode ?? "—"}\` — ${i.errorMessage ?? ""}

## Impact
- ${impact.failures} of ${impact.runs} executions failed during the incident window (${impact.failureRate === null ? "n/a" : `${(impact.failureRate * 100).toFixed(1)}%`} failure rate).
- The error signature occurred ${impact.occurrences} time(s)${impact.occurrencesPerHour ? ` (~${impact.occurrencesPerHour.toFixed(1)}/hour)` : ""}.

## Root cause
${d ? `${d.rootCause.summary}\n\nEvidence:\n${d.rootCause.evidence.map((e) => `- ${e}`).join("\n")}\n\n_Analysis by ${inv.provider} (${inv.model}, ${inv.promptVersion})${inv.usedFallback ? " — AI provider unavailable, deterministic fallback used" : ""}. Confidence ${Math.round((d.confidence ?? 0) * 100)}% is a model-reported estimate, not a calibrated probability._` : "_No investigation was run._"}

## Recovery
${planSections.length ? planSections.join("\n\n") : "_No recovery plan was created._"}

## Timeline (UTC)
${events.map(({ e, email }) => `- ${formatDateTime(e.createdAt)} — **${titleCase(e.eventType)}**${e.actorType === "user" ? ` by ${email}` : ` (${e.actorType})`}${e.metadata && (e.metadata as { to?: string }).to ? ` → ${(e.metadata as { to?: string }).to}` : ""}${(e.metadata as { note?: string }).note ? ` — “${(e.metadata as { note?: string }).note}”` : ""}`).join("\n")}

## What we will do differently
${runbook.steps.map((s) => `- [ ] ${s}`).join("\n")}
- [ ] Review whether \`${w.name}\` has the right side-effect profile and auto-recovery setting.

## Audit references
${audit.length ? audit.map((a) => `- ${formatDateTime(a.createdAt)} \`${a.action}\` (${a.actorType})`).join("\n") : "- See the audit log for plan-level records."}
`;
  return { filename: `${ref.toLowerCase()}-postmortem.md`, markdown };
}

/** Public, opt-in status page data: aggregate health only, no incident details. */
export async function publicStatus(slug: string) {
  const db = await getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  if (!org || !org.statusPageEnabled) return null;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const day = sql<string>`to_char(date_trunc('day', ${executions.startedAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
  const [wfs, daily, active] = await Promise.all([
    db.select({ id: workflows.id, name: workflows.name, status: workflows.status }).from(workflows).where(and(eq(workflows.organizationId, org.id), sql`${workflows.status} <> 'archived'`)).orderBy(workflows.name),
    db
      .select({ workflowId: executions.workflowId, day, runs: sql<number>`count(*)::int`, failures: sql<number>`count(*) filter (where ${executions.status} in ('error','crashed'))::int` })
      .from(executions)
      .where(and(eq(executions.organizationId, org.id), gte(executions.startedAt, since)))
      .groupBy(executions.workflowId, day),
    db
      .select({ workflowId: incidents.workflowId, severity: incidents.severity })
      .from(incidents)
      .where(and(eq(incidents.organizationId, org.id), sql`${incidents.status} in ('open','investigating','awaiting_approval','recovering')`)),
  ]);
  const days = Array.from({ length: 30 }, (_, k) => new Date(Date.now() - (29 - k) * 86_400_000).toISOString().slice(0, 10));
  const rank = { low: 0, medium: 1, high: 2, critical: 3 } as const;
  const services = wfs.map((wf) => {
    const rows = daily.filter((r) => r.workflowId === wf.id);
    const bars = days.map((dd) => {
      const r = rows.find((x) => x.day === dd);
      return { day: dd, runs: r?.runs ?? 0, successRate: r && r.runs ? (r.runs - r.failures) / r.runs : null };
    });
    const totals = rows.reduce((a, r) => ({ runs: a.runs + r.runs, failures: a.failures + r.failures }), { runs: 0, failures: 0 });
    const worst = active.filter((a) => a.workflowId === wf.id).reduce((m, a) => Math.max(m, rank[a.severity]), -1);
    const state = wf.status === "inactive" ? "paused" : worst >= 2 ? "major_outage" : worst >= 0 ? "degraded" : "operational";
    return { name: wf.name, state, uptime: totals.runs ? (totals.runs - totals.failures) / totals.runs : null, bars };
  });
  const overall = services.some((s) => s.state === "major_outage") ? "major_outage" : services.some((s) => s.state === "degraded") ? "degraded" : "operational";
  return { organization: org.name, isDemo: org.isDemo, overall, services, generatedAt: new Date().toISOString() };
}

export async function setStatusPage(ctx: ServiceContext, enabled: boolean) {
  authorize(ctx, "org:settings");
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ statusPageEnabled: enabled }).where(eq(organizations.id, ctx.organizationId));
    await recordAudit(tx, ctx, { action: enabled ? "status_page.enabled" : "status_page.disabled", targetType: "organization", targetId: ctx.organizationId });
  });
}
