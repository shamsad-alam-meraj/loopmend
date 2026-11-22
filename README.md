# Loopmend

**AI-powered workflow reliability & self-healing for n8n automations.**

Loopmend ingests failures from n8n, investigates them with evidence, proposes policy-checked recovery plans, gets the right human to approve, and executes recoveries idempotently, with an append-only audit trail that proves every step.

It is a single **Next.js modular monolith** (no microservices, no Redis) backed by **Supabase Postgres + Auth + Realtime**, with **Gemini** behind a provider abstraction and **n8n** as the orchestrator. It is designed for a $0 initial deployment (Vercel Hobby + Supabase Free + Oracle Cloud Always Free).

```
n8n Error Trigger ──signed event──▶ ingest once ──▶ incident ──▶ investigate (Gemini / rules)
        ▲                                                              │
        └── signed, idempotent recovery ◀── execute ◀── approve ◀── policy-checked plan
                                                    └──▶ append-only audit log
```

---

## Contents
- [Features](#features)
- [Quick start (zero config)](#quick-start-zero-config)
- [Architecture](#architecture)
- [Security model](#security-model)
- [API](#api)
- [Configuration](#configuration)
- [Testing](#testing)
- [CI/CD & deployment](#cicd--deployment)
- [n8n setup](#n8n-setup)
- [Project structure](#project-structure)
- [Limitations & next steps](#limitations--next-steps)

---

## Features

| Area | What it does |
|---|---|
| **Signed ingestion** | `POST /api/v1/webhooks/n8n/incident` with per-integration HMAC-SHA256 over `timestamp.nonce.body`, ±5 min window, single-use nonces, 256 KB cap, rate limiting. |
| **Idempotency** | `(organization, eventId)` is claimed inside the incident transaction: retries and concurrent deliveries can't create duplicates. Reusing an `eventId` with a different payload returns 409. |
| **Correlation** | Failures are fingerprinted (workflow + error signature + node). Recurrences while an incident is open increment a counter instead of opening new incidents. |
| **n8n adapter** | Normalizes raw Error Trigger / trigger-failure payloads from different n8n versions into one canonical contract; redacts tokens, keys, emails and card-like numbers. |
| **AI investigation** | Two-step classify → investigate with versioned prompts and sanitized, delimited evidence (recent executions, 24h vs baseline p95, related incidents). Output is Zod-validated; strategies are allowlisted. Retry, then fall back to a deterministic rules engine. Model, prompt version, latency and fallback use are persisted. |
| **Recovery policy** | Pure, deterministic `evaluatePolicy()`: risk level, approver role, four-eyes rule for high risk, retry budget per workflow (circuit breaker), attempt caps, deadlines. Financial/destructive workflows are never retried automatically. AI confidence is informational only. |
| **Approvals** | One immutable decision per plan (unique index + trigger). High-risk plans need an admin who is not the requester. |
| **Idempotent execution** | Row-locked atomic claim + unique per-attempt idempotency key; side-effect check before retries of non-idempotent work; exponential backoff with full jitter; dead-letter on exhaustion, non-retryable or ambiguous outcomes. |
| **Self-healing** | Low-risk plans on idempotent workflows with auto-recovery enabled run without approval. |
| **Analytics** | Success rate, p50/p95, MTTR/MTTA, SLOs with error budgets by criticality, recovery success rates, and anomaly detection (failure-rate z-score, MAD latency regression, silence). |
| **Realtime** | Supabase Realtime (`postgres_changes` under RLS) or an SSE change feed; dashboards refresh live. |
| **Multi-tenancy** | Owner / admin / operator / viewer, enforced in route handlers, server actions **and** services, plus Postgres RLS on every tenant table. |
| **Extras** | ⌘K command palette · blameless postmortem generator (Markdown) · incident impact panel · category runbooks · opt-in public status page · failure simulator · interactive landing page with an in-browser policy playground. |

## Quick start (zero config)

Requirements: Node.js ≥ 20.9.

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Open http://localhost:3000. With no `DATABASE_URL`, an **embedded Postgres (PGlite)** is created in `.data/pglite`, migrated, and seeded with two clearly-labeled demo organizations (14 days of executions, real incidents created through the ingestion pipeline). With no Supabase keys, **local auth** is used; with no `GEMINI_API_KEY`, the **rules engine** investigates.

On the sign-in page, use the one-click demo buttons (owner / admin / operator / viewer of *Acme*, owner of *Globex*). The seeded demo accounts' password is defined in `src/lib/db/demo-data.ts` (local/demo use only; demo mode is off in production unless `ENABLE_DEMO_MODE=true`).

**Try the full lifecycle:** sign in as *operator* → Overview → *Failure simulator* (sends a signed n8n payload through the public webhook and re-delivers it to prove idempotency) → open the incident → *Run investigation* → *Approve* → *Execute* → see the incident resolve and the audit log fill in.

Reset local data: `npm run db:reset:local`.

## Architecture

| Layer | Choice |
|---|---|
| App | Next.js 16 App Router, TypeScript, Server Components, Route Handlers (`/api/v1`), Server Actions, `proxy.ts` |
| UI | Tailwind CSS v4, shadcn-style components, Recharts |
| Data | Supabase Postgres via Drizzle ORM (postgres-js); PGlite for local/tests |
| Auth | Supabase Auth (`@supabase/ssr`) or signed local sessions |
| AI | Gemini REST structured output behind `AiProvider` |
| Automation | Self-hosted n8n (Docker, Caddy, separate Postgres) |
| Validation | Zod for requests, webhooks and AI output |
| Tests | Vitest (unit + integration on real Postgres semantics), Playwright E2E |

Route Handlers are thin; business rules live in `src/services/*`, contracts in `src/lib/validation`, provider code behind adapters (`src/lib/ai`, `src/lib/n8n`, `src/lib/recovery/executor.ts`).

**Data model (15 tables):** organizations, memberships, profiles, integrations (AES-256-GCM `encrypted_config`), workflows, workflow_versions, executions, ingested_events (idempotency ledger), webhook_nonces (replay protection), incidents, incident_events, ai_investigations, recovery_plans (unique `idempotency_key`), approvals (immutable), recovery_attempts (unique per-attempt key), audit_logs (append-only). Every tenant row carries `organization_id`; incidents are indexed by `(organization_id, status, created_at)`.

## Security model

- **Authorization** is checked server-side three times: route handler / server action → service boundary (`authorize(ctx, permission)`) → Postgres RLS (`lm_is_member()` policies). Hiding a button is never the control.
- **Cross-tenant access** returns 404 (indistinguishable from "doesn't exist"); a spoofed `x-organization-id` returns 403.
- **Webhooks**: HMAC-SHA256, timestamp window, single-use nonces (consumed only after signature verification), size limits, rate limits.
- **Secrets**: integration credentials are encrypted with AES-256-GCM, bound to their organization via AAD, shown once, and rotatable; client roles cannot read `encrypted_config` (column-level grants). Nothing secret uses `NEXT_PUBLIC_`.
- **Auditability**: `audit_logs` UPDATE/DELETE and approval mutations are blocked by database triggers.
- **AI safety**: sanitized, delimited context treated as data; schema-validated output; allowlisted strategies; deterministic guards; confidence never authorizes execution.
- **Recovery safety**: approval gates, four-eyes for high risk, retry budgets, deadlines, side-effect checks, dead-letter for ambiguous outcomes.
- **Headers**: `nosniff`, `X-Frame-Options: DENY`, strict referrer and permissions policies.
- **Review**: an independent security review (2026-11-22) and its fixes are documented in [SECURITY.md](SECURITY.md).

## API

All responses use the envelope `{ success, data, error, meta: { requestId } }`. User endpoints require a session and organization membership (optionally `x-organization-id`).

| Method | Endpoint | Permission |
|---|---|---|
| POST | `/api/v1/webhooks/n8n/incident` | signed (machine) |
| POST | `/api/v1/webhooks/n8n/recovery` | signed (machine), async recovery result |
| GET | `/api/v1/incidents?view=&status=&severity=&category=&workflowId=&q=&cursor=` | viewer |
| GET / PATCH | `/api/v1/incidents/:id` | viewer / operator |
| POST | `/api/v1/incidents/:id/investigate` | operator |
| GET | `/api/v1/incidents/:id/postmortem` | viewer |
| GET | `/api/v1/investigations?incidentId=` | viewer |
| GET | `/api/v1/workflows` · `/api/v1/workflows/:id` · `/api/v1/workflows/:id/executions` | viewer |
| PATCH | `/api/v1/workflows/:id` (criticality, side effects, auto-recovery) | admin |
| GET / POST | `/api/v1/recovery-plans` (`Idempotency-Key` supported) | viewer / operator |
| GET | `/api/v1/recovery-plans/:id` | viewer |
| POST | `/api/v1/recovery-plans/:id/approve` · `/reject` | operator (admin for high risk) |
| POST | `/api/v1/recovery-plans/:id/execute` | operator |
| GET | `/api/v1/analytics/reliability?days=` | viewer |
| GET | `/api/v1/audit` | operator |
| GET | `/api/v1/events/stream` (SSE) | viewer |
| GET | `/api/v1/cron/recoveries` · `/api/v1/cron/reliability-report` | `Authorization: Bearer $CRON_SECRET` |
| GET | `/api/v1/health` | public (503 when the database is down) |

Canonical incident event:

```json
{
  "event": "workflow.execution.failed",
  "eventId": "evt_01JXYZ",
  "source": "n8n",
  "workflow": { "id": "workflow_123", "name": "Payment Notification" },
  "execution": { "id": "execution_456", "status": "error", "durationMs": 3400,
                 "error": { "code": "RATE_LIMITED", "message": "HTTP 429: Too Many Requests" } },
  "occurredAt": "2026-11-17T10:00:00Z"
}
```

## Configuration

See [`.env.example`](.env.example). Everything is optional locally.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres/Supabase. Empty → embedded PGlite. Supabase transaction pooler (`:6543`) is supported (prepared statements disabled automatically). |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Enables Supabase Auth + Realtime. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Enables Gemini (default `gemini-2.5-flash`). |
| `N8N_WEBHOOK_URL` | Recovery-executor webhook (e.g. `https://n8n.example.com/webhook/loopmend-recovery`). Empty → simulated executor in demo mode. |
| `ENCRYPTION_KEY` | 32 bytes, base64 (`openssl rand -base64 32`). Required in production. |
| `SESSION_SECRET`, `CRON_SECRET`, `N8N_WEBHOOK_SECRET` | ≥ 32 chars. Required in production. |
| `ENABLE_DEMO_MODE` | Demo sign-in, simulator and embedded DB (default on outside production; required to use the embedded DB in production). |
| `LOOPMEND_INTERNAL_URL` | Runtime URL the simulator posts to (falls back to `NEXT_PUBLIC_APP_URL`, which is inlined at build time). |
| `ALLOW_PRIVATE_INTEGRATION_URLS` | Allow private/loopback n8n URLs in production (self-hosted on one network). |
| `WEBHOOK_RATE_LIMIT_PER_SEC` | Sustained webhook events/s per integration (default 50, burst 4×). |
| `SENTRY_DSN` | Error reporting via Sentry's envelope API. |

## Testing

```bash
npm run test:unit
```

```bash
npm run test:integration
```

```bash
npx playwright install chromium && npm run test:e2e
```

Integration tests run against an in-memory Postgres (PGlite) with the real migrations, including RLS policies exercised under the `authenticated` role. Acceptance criteria from the design doc and where they're proven:

| Acceptance test | Covered by |
|---|---|
| Duplicate event ingestion → no duplicate incident | `webhook-ingestion.test.ts` (re-delivery + 6 concurrent deliveries) |
| Invalid webhook signature → rejected | `webhook-ingestion.test.ts`, `ingestion-units.test.ts`, E2E |
| Replayed / stale request → rejected | `webhook-ingestion.test.ts` |
| Cross-organization access → denied by server and RLS | `incidents-api.test.ts`, `database.test.ts` (RLS), E2E |
| Duplicate recovery request → no duplicate side effect | `recovery.test.ts` (repeat + concurrent execute) |
| AI provider failure → graceful fallback | `investigation.test.ts` (HTTP 503, invalid JSON, schema/allowlist violations) |
| Retry exhaustion → dead-letter | `recovery.test.ts` |
| Database outage → controlled error, no false success | `/api/v1/health` returns 503; route wrapper maps dependency errors to 503 |
| Recovery audit → complete record | `recovery.test.ts`, E2E lifecycle |
| Critical user journeys → automated E2E | `tests/e2e/*` |

## CI/CD & deployment

**Pipelines** (`.github/workflows`):
- `ci.yml`: typecheck → ESLint → unit → integration; **migration job** on a Postgres 16 service (schema/migration drift check, apply twice, seed); production build + Playwright E2E.
- `deploy.yml`: on `main`: CI → **apply reviewed Drizzle migrations to production** → `vercel build --prod` → `vercel deploy --prebuilt --prod` → smoke test. Pull requests get preview deployments with a comment.

**One-time setup**

1. **Supabase**: create a project. In *Auth → URL configuration*, add `https://<your-domain>/auth/callback`. Copy the URL and anon key. For migrations, use the **session pooler / direct** connection string (port 5432) as `DATABASE_URL`; the app runtime can use the transaction pooler (6543).
2. **Vercel**: import the repo, then set environment variables per environment (all from the table above). Generate secrets with `openssl rand -hex 32` and `openssl rand -base64 32`.
3. **GitHub**: add repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and an environment **production** (with required reviewers if you want a manual gate) containing `DATABASE_URL`.
4. Add the repository **variable** `DEPLOY_ENABLED=true` (Settings → Secrets and variables → Actions → Variables). Until then, pushes run CI only.
5. Push to `main`. The pipeline migrates, deploys and smoke-tests (`infrastructure/scripts/smoke-test.sh`).

**Migrations**: `npm run db:generate` after editing `drizzle/schema.ts`, review the SQL, commit. CI fails if the schema changes without a migration. Prefer the pipeline's migrate step; alternatively set `RUN_MIGRATIONS_ON_BUILD=true` to migrate inside `vercel-build` for production builds. Supabase-specific pieces (RLS helpers, `auth.uid()`, Realtime publication) are written to be idempotent and no-op on plain Postgres.

**Scheduling**: Vercel Hobby crons run at most daily (`vercel.json` keeps a daily fallback). The n8n **health-monitor** workflow calls `/api/v1/cron/recoveries` every minute to run backoff retries and enforce deadlines.

**Self-hosting the app**: `docker build -t loopmend .` produces a standalone, non-root image with a health check.

## n8n setup

1. Provision an Ubuntu ARM64 VM (Oracle Cloud Always Free) and run `infrastructure/scripts/provision-oracle-vm.sh` (Docker, ufw, fail2ban, unattended upgrades). Open 80/443 in the VCN security list.
2. In Loopmend → **Settings → n8n integrations**, connect n8n and copy the integration id + signing secret (shown once).
3. `cd infrastructure/docker && cp .env.example .env`, fill it in, then `docker compose up -d`. Caddy provisions HTTPS; only `/webhook/*` is public and the editor is restricted to `EDITOR_ALLOWED_IPS`.
4. Import the workflows in [`n8n/workflows`](n8n/workflows) (see its README), create an n8n API key for the recovery executor, set **incident-ingestion** as the *Error Workflow* of each monitored workflow, and activate the scheduler.
5. Back up nightly with `infrastructure/scripts/backup.sh` (copy off-VM via `RCLONE_REMOTE`), and test `restore.sh` periodically.

> n8n Community Edition is under the Sustainable Use License. Keep n8n administration under the operator's control and review licensing before offering hosted n8n to customers.

## Project structure

```
src/
  app/                  (auth) login/register/onboarding · (dashboard) overview, incidents, workflows,
                        investigations, recoveries, approvals, analytics, audit, settings · status/[slug]
    api/v1/             webhooks/n8n, incidents, workflows, investigations, recovery-plans,
                        analytics, audit, events/stream, cron, health
  services/             incident, ingestion, investigation, recovery, workflow, reliability,
                        organization, integration, insights, audit, hooks
  lib/                  ai/ (providers, prompts, schemas) · n8n/ (adapter, signing) · recovery/ (policy,
                        backoff, executor) · analytics/ · auth/ · db/ · security/ · validation/ · http/
  components/           ui/ dashboard/ incidents/ recoveries/ investigations/ charts/ landing/ palette/
  proxy.ts              session refresh + route guard (Next 16 replacement for middleware.ts)
drizzle/                schema.ts + reviewed SQL migrations (RLS, triggers, realtime)
n8n/workflows/          exported workflows (ingestion, recovery executor, scheduler, reporter, analyzer)
infrastructure/         docker/ (n8n compose) · caddy/ · scripts/ (migrate, seed, smoke, backup, restore)
tests/                  unit/ · integration/ · e2e/
```

## Limitations & next steps

- Rate limiting and the SSE change feed are per-instance; on multi-instance deployments, rely on Supabase Realtime and move rate limits to a shared store when traffic justifies it.
- Free tiers have no uptime guarantees (Supabase projects pause after inactivity; Oracle capacity varies by region).
- Measured ingestion performance is in [`benchmarks/`](benchmarks): about 48 events/s with p95 681 ms at concurrency 25 on one laptop process, and zero duplicate incidents under a 50× concurrent duplicate storm. Recovery success against live n8n and multi-instance throughput are not measured yet.
