/**
 * Loopmend application schema (Supabase PostgreSQL / PGlite).
 *
 * Invariants:
 *  - Every tenant-owned row carries organization_id (denormalized on children
 *    so RLS policies and indexes never need joins).
 *  - External identifiers are unique per organization.
 *  - Recovery operations carry unique idempotency keys.
 *  - Credentials only ever live in integrations.encrypted_config (AES-256-GCM).
 *  - audit_logs is append-only (enforced by trigger, see custom migration).
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ---------------------------------------------------------------- enums
export const roleEnum = pgEnum("member_role", ["owner", "admin", "operator", "viewer"]);
export const integrationTypeEnum = pgEnum("integration_type", ["n8n"]);
export const integrationStatusEnum = pgEnum("integration_status", ["pending", "connected", "error", "disabled"]);
export const workflowStatusEnum = pgEnum("workflow_status", ["active", "inactive", "degraded", "archived"]);
export const criticalityEnum = pgEnum("workflow_criticality", ["low", "medium", "high", "critical"]);
/** What happens if the workflow runs twice — drives recovery policy. */
export const sideEffectEnum = pgEnum("side_effect_profile", ["read_only", "idempotent", "non_idempotent", "financial", "destructive"]);
export const executionStatusEnum = pgEnum("execution_status", ["success", "error", "running", "waiting", "canceled", "crashed"]);
export const severityEnum = pgEnum("incident_severity", ["low", "medium", "high", "critical"]);
export const categoryEnum = pgEnum("incident_category", [
  "rate_limit",
  "authentication",
  "network",
  "timeout",
  "validation",
  "upstream_outage",
  "configuration",
  "data_quality",
  "resource_exhausted",
  "unknown",
]);
export const incidentStatusEnum = pgEnum("incident_status", [
  "open",
  "investigating",
  "awaiting_approval",
  "recovering",
  "resolved",
  "dead_letter",
  "dismissed",
]);
export const investigationStatusEnum = pgEnum("investigation_status", ["pending", "completed", "failed"]);
export const recoveryStrategyEnum = pgEnum("recovery_strategy", [
  "retry_execution",
  "exponential_backoff",
  "refresh_credentials_then_retry",
  "pause_workflow",
  "notify_owner",
  "manual_review",
]);
export const recoveryStatusEnum = pgEnum("recovery_status", [
  "pending_approval",
  "approved",
  "rejected",
  "executing",
  "succeeded",
  "failed",
  "dead_letter",
  "cancelled",
]);
export const riskLevelEnum = pgEnum("risk_level", ["low", "medium", "high"]);
export const approvalDecisionEnum = pgEnum("approval_decision", ["approved", "rejected"]);
export const attemptStatusEnum = pgEnum("attempt_status", ["started", "succeeded", "failed"]);
export const actorTypeEnum = pgEnum("actor_type", ["user", "system", "n8n", "ai"]);

// ---------------------------------------------------------------- identity & tenancy
/** Mirrors auth.users (Supabase) or holds local demo-auth users. */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  /** scrypt hash — only used by local auth mode; null for Supabase users. */
  passwordHash: text("password_hash"),
  createdAt: createdAt(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Monotonic counter for human-readable incident numbers (INC-0042). */
  incidentSeq: integer("incident_seq").notNull().default(0),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("viewer"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId), index("memberships_user_idx").on(t.userId)],
);

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    type: integrationTypeEnum("type").notNull().default("n8n"),
    name: text("name").notNull(),
    baseUrl: text("base_url"),
    /** AES-256-GCM ciphertext (v1:iv:tag:data). Never plaintext. */
    encryptedConfig: text("encrypted_config").notNull(),
    /** Non-secret hint for the UI, e.g. last 4 chars of the API key. */
    secretHint: text("secret_hint"),
    status: integrationStatusEnum("status").notNull().default("pending"),
    lastVerifiedAt: ts("last_verified_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integrations_org_type_name_uq").on(t.organizationId, t.type, t.name)],
);

// ---------------------------------------------------------------- workflows & executions
export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: workflowStatusEnum("status").notNull().default("active"),
    criticality: criticalityEnum("criticality").notNull().default("medium"),
    sideEffectProfile: sideEffectEnum("side_effect_profile").notNull().default("non_idempotent"),
    /** Whether low-risk recovery may run without human approval. */
    autoRecoveryEnabled: boolean("auto_recovery_enabled").notNull().default(false),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    lastExecutionAt: ts("last_execution_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("workflows_org_external_uq").on(t.organizationId, t.externalId)],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definitionHash: text("definition_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("workflow_versions_wf_version_uq").on(t.workflowId, t.version)],
);

export const executions = pgTable(
  "executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    status: executionStatusEnum("status").notNull(),
    mode: text("mode"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorNode: text("error_node"),
    httpStatus: integer("http_status"),
    /** Sanitized metadata only (no payload bodies / secrets). */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** Set when this execution was triggered by a Loopmend recovery attempt. */
    recoveryAttemptId: uuid("recovery_attempt_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("executions_org_external_uq").on(t.organizationId, t.externalId),
    index("executions_workflow_started_idx").on(t.workflowId, t.startedAt),
    index("executions_org_started_idx").on(t.organizationId, t.startedAt),
  ],
);

// ---------------------------------------------------------------- ingestion
/** Idempotency ledger for inbound events: one row per (org, eventId). */
export const ingestedEvents = pgTable(
  "ingested_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    source: text("source").notNull(),
    payloadHash: text("payload_hash").notNull(),
    incidentId: uuid("incident_id"),
    executionId: uuid("execution_id"),
    outcome: text("outcome").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ingested_events_org_event_uq").on(t.organizationId, t.eventId)],
);

/** Replay protection: each signed request nonce may be used once. */
export const webhookNonces = pgTable(
  "webhook_nonces",
  {
    nonce: text("nonce").primaryKey(),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [index("webhook_nonces_received_idx").on(t.receivedAt)],
);

// ---------------------------------------------------------------- incidents
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    executionId: uuid("execution_id").references(() => executions.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    severity: severityEnum("severity").notNull().default("medium"),
    category: categoryEnum("category").notNull().default("unknown"),
    status: incidentStatusEnum("status").notNull().default("open"),
    /** Correlation key (workflow + error signature) used to group recurrences. */
    fingerprint: text("fingerprint").notNull(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    assigneeId: uuid("assignee_id").references(() => profiles.id, { onDelete: "set null" }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    acknowledgedAt: ts("acknowledged_at"),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("incidents_org_number_uq").on(t.organizationId, t.number),
    index("incidents_org_status_created_idx").on(t.organizationId, t.status, t.createdAt),
    index("incidents_org_fingerprint_idx").on(t.organizationId, t.fingerprint),
  ],
);

export const incidentEvents = pgTable(
  "incident_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    actorType: actorTypeEnum("actor_type").notNull().default("system"),
    actorId: uuid("actor_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("incident_events_incident_idx").on(t.incidentId, t.createdAt)],
);

// ---------------------------------------------------------------- AI
export const aiInvestigations = pgTable(
  "ai_investigations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
    status: investigationStatusEnum("status").notNull().default("pending"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    /** Validated AI output contract (see src/lib/ai/schemas). */
    diagnosis: jsonb("diagnosis").$type<Record<string, unknown>>(),
    category: categoryEnum("category"),
    severity: severityEnum("severity"),
    rootCauseSummary: text("root_cause_summary"),
    /** Model-reported estimate, NOT a calibrated probability. */
    confidence: real("confidence"),
    /** References to the evidence (executions, prior incidents) given to the model. */
    evidenceRefs: jsonb("evidence_refs").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    usedFallback: boolean("used_fallback").notNull().default(false),
    error: text("error"),
    latencyMs: integer("latency_ms"),
    requestedBy: uuid("requested_by"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("ai_investigations_incident_idx").on(t.incidentId, t.createdAt)],
);

// ---------------------------------------------------------------- recovery
export const recoveryPlans = pgTable(
  "recovery_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
    investigationId: uuid("investigation_id").references(() => aiInvestigations.id, { onDelete: "set null" }),
    strategy: recoveryStrategyEnum("strategy").notNull(),
    status: recoveryStatusEnum("status").notNull().default("pending_approval"),
    riskLevel: riskLevelEnum("risk_level").notNull().default("medium"),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    maxAttempts: integer("max_attempts").notNull().default(3),
    attemptsUsed: integer("attempts_used").notNull().default(0),
    baseDelayMs: integer("base_delay_ms").notNull().default(2000),
    deadlineAt: ts("deadline_at").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    /** Deterministic policy decision: reasons, checks performed. */
    policy: jsonb("policy").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    rationale: text("rationale"),
    nextAttemptAt: ts("next_attempt_at"),
    deadLetterReason: text("dead_letter_reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("recovery_plans_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    index("recovery_plans_incident_idx").on(t.incidentId),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    recoveryPlanId: uuid("recovery_plan_id").notNull().references(() => recoveryPlans.id, { onDelete: "cascade" }),
    decidedBy: uuid("decided_by").notNull().references(() => profiles.id),
    decision: approvalDecisionEnum("decision").notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  // One decision per plan — prevents double approval races.
  (t) => [uniqueIndex("approvals_plan_uq").on(t.recoveryPlanId)],
);

export const recoveryAttempts = pgTable(
  "recovery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    recoveryPlanId: uuid("recovery_plan_id").notNull().references(() => recoveryPlans.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    /** plan idempotency key + attempt number; sent to n8n as Idempotency-Key. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: attemptStatusEnum("status").notNull().default("started"),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    error: text("error"),
    durationMs: integer("duration_ms"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [uniqueIndex("recovery_attempts_plan_number_uq").on(t.recoveryPlanId, t.attemptNumber)],
);

// ---------------------------------------------------------------- audit
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt), index("audit_logs_target_idx").on(t.targetType, t.targetId)],
);

// ---------------------------------------------------------------- relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  workflows: many(workflows),
  incidents: many(incidents),
}));
export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, { fields: [memberships.organizationId], references: [organizations.id] }),
  user: one(profiles, { fields: [memberships.userId], references: [profiles.id] }),
}));
export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  organization: one(organizations, { fields: [workflows.organizationId], references: [organizations.id] }),
  executions: many(executions),
  incidents: many(incidents),
}));
export const executionsRelations = relations(executions, ({ one }) => ({
  workflow: one(workflows, { fields: [executions.workflowId], references: [workflows.id] }),
}));
export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  workflow: one(workflows, { fields: [incidents.workflowId], references: [workflows.id] }),
  execution: one(executions, { fields: [incidents.executionId], references: [executions.id] }),
  assignee: one(profiles, { fields: [incidents.assigneeId], references: [profiles.id] }),
  events: many(incidentEvents),
  investigations: many(aiInvestigations),
  recoveryPlans: many(recoveryPlans),
}));
export const incidentEventsRelations = relations(incidentEvents, ({ one }) => ({
  incident: one(incidents, { fields: [incidentEvents.incidentId], references: [incidents.id] }),
}));
export const aiInvestigationsRelations = relations(aiInvestigations, ({ one }) => ({
  incident: one(incidents, { fields: [aiInvestigations.incidentId], references: [incidents.id] }),
}));
export const recoveryPlansRelations = relations(recoveryPlans, ({ one, many }) => ({
  incident: one(incidents, { fields: [recoveryPlans.incidentId], references: [incidents.id] }),
  investigation: one(aiInvestigations, { fields: [recoveryPlans.investigationId], references: [aiInvestigations.id] }),
  approvals: many(approvals),
  attempts: many(recoveryAttempts),
}));
export const approvalsRelations = relations(approvals, ({ one }) => ({
  plan: one(recoveryPlans, { fields: [approvals.recoveryPlanId], references: [recoveryPlans.id] }),
  decider: one(profiles, { fields: [approvals.decidedBy], references: [profiles.id] }),
}));
export const recoveryAttemptsRelations = relations(recoveryAttempts, ({ one }) => ({
  plan: one(recoveryPlans, { fields: [recoveryAttempts.recoveryPlanId], references: [recoveryPlans.id] }),
}));

export type Role = (typeof roleEnum.enumValues)[number];
export type Severity = (typeof severityEnum.enumValues)[number];
export type Category = (typeof categoryEnum.enumValues)[number];
export type IncidentStatus = (typeof incidentStatusEnum.enumValues)[number];
export type RecoveryStrategy = (typeof recoveryStrategyEnum.enumValues)[number];
export type RecoveryStatus = (typeof recoveryStatusEnum.enumValues)[number];
export type SideEffectProfile = (typeof sideEffectEnum.enumValues)[number];
export type Criticality = (typeof criticalityEnum.enumValues)[number];
export type ExecutionStatus = (typeof executionStatusEnum.enumValues)[number];
export type RiskLevel = (typeof riskLevelEnum.enumValues)[number];
