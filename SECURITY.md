# Security

## Reporting a vulnerability
Please report suspected vulnerabilities privately via GitHub's **Security → Report a vulnerability** on this repository rather than in a public issue. Include the affected endpoint or file, reproduction steps and impact.

## Threat model (summary)

| Asset | Threats | Controls |
|---|---|---|
| Tenant data (incidents, executions, audit) | Cross-tenant reads/writes (IDOR), privilege escalation | Org-scoped queries in every service; `authorize()` at the service boundary; route/action checks; Postgres RLS with read-only client roles; cross-tenant ids return 404 |
| Ingestion endpoint | Forged, replayed or stale events; duplicate incidents; resource exhaustion | Per-integration HMAC-SHA256; ±300 s timestamp; single-use nonces (consumed after signature check); idempotency ledger; streaming 256 KB body cap; per-integration rate limit |
| Recovery execution | Unapproved or repeated side effects; AI-driven unsafe actions | Allowlisted strategies; deterministic policy; approval gates (admin + four-eyes for high risk); atomic claim + per-attempt idempotency key; side-effect check; dead-letter for ambiguous outcomes |
| Credentials (n8n API keys, webhook secrets) | Disclosure at rest, via API, or to client roles | AES-256-GCM bound to the organization (AAD); shown once; column grants deny client roles; never returned by APIs |
| Sessions | Theft, fixation, open redirect after login | HttpOnly/SameSite cookies; HMAC-signed local tokens with server-side revocation (`session_version`); Supabase sessions refreshed in `proxy.ts`; strict same-origin `next` validation |
| Outbound requests | SSRF via user-supplied n8n URLs or Host headers | DNS-resolved private/loopback/link-local/metadata blocking in production, no redirects, generic errors; simulator posts only to configured URLs |
| Audit trail | Tampering | `audit_logs` and `approvals` immutable via database triggers |

## Security review — 2026-11-22
An independent review read every service query, route handler, server action, the webhook path, crypto, RLS migrations and public pages. **No critical issues and no tenant-isolation holes were found.** Findings and resolutions:

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | Medium | Open redirect via `?next=/\evil.com` after login | `safeRedirectPath()` parses with the URL parser and rejects backslashes/control characters (raw or encoded) |
| 2 | Medium | Embedded DB could auto-seed demo users (public password) in production | Embedded DB and seeding refuse to run in production without `ENABLE_DEMO_MODE=true`; demo accounts can't sign in outside demo mode; no public fallback webhook secret |
| 3 | Medium-low | SSRF through "Test n8n API" (localhost allowed, redirects followed, verbose errors) | `assertSafeOutboundUrl()` after DNS resolution, `redirect: "manual"`, generic errors; private targets only with `ALLOW_PRIVATE_INTEGRATION_URLS=true` |
| 4 | Medium-low | Simulator derived its target from the Host header | Uses `LOOPMEND_INTERNAL_URL` / `NEXT_PUBLIC_APP_URL` only in production; simulator gated to demo mode |
| 5 | Low | Login throttle keyed on spoofable `X-Forwarded-For` | Platform IP / right-most hop, plus a per-account limit |
| 6 | Low | Webhook bodies buffered before the size check | Streaming read aborts past the limit |
| 7 | Low | Local sessions not revocable | `profiles.session_version`; sign-out revokes all sessions |
| 8 | Low | "Add member" reveals whether an email is registered (admins only) | **Open** — needs an invite flow |
| 9 | Low | `SECURITY DEFINER` search path without `pg_temp` last | Migration 0005 sets `pg_catalog, public, pg_temp` and revokes `PUBLIC` execute |
| 10 | Info | Proxy dev-secret fallback; disabled integrations selectable | Proxy fails closed in production; disabled integrations excluded |

Every fix has a regression test (`tests/unit/security-fixes.test.ts`, `tests/integration/security-fixes.test.ts`).

## Known limitations
- Rate limits are per instance (in memory). Use a shared store for strict global limits on multi-instance deployments.
- Member invitations add existing accounts directly (see #8).
- Free-tier hosting provides no availability guarantees; back up n8n with `infrastructure/scripts/backup.sh` and test restores.
