# Loopmend n8n workflows

Small, independently versioned workflows exported as JSON. They read configuration from environment variables set in `infrastructure/docker/docker-compose.yml` (`LOOPMEND_URL`, `LOOPMEND_INTEGRATION_ID`, `LOOPMEND_WEBHOOK_SECRET`, `LOOPMEND_CRON_SECRET`, `N8N_PUBLIC_API_KEY`, `SLACK_WEBHOOK_URL`), so no credentials live in the exports.

| File | Trigger | Responsibility |
|---|---|---|
| `incident-ingestion.json` | Error Trigger | Normalize the failure → derive a stable `eventId` → HMAC-sign → POST to Loopmend with bounded retries (fresh nonce per attempt, same event) → fail loudly on permanent errors. |
| `recovery-executor.json` | Webhook `POST /webhook/loopmend-recovery` | Validate signature, timestamp and integration → allowlisted strategies only → idempotency-key and nonce dedupe → check deadline → retry the execution / deactivate the workflow / notify via the n8n public API → respond with the result. |
| `health-monitor.json` | Schedule (every minute) | Call `/api/v1/cron/recoveries` (backoff retries, deadlines, ambiguous attempts → dead-letter) and check `/api/v1/health`. |
| `reliability-reporter.json` | Schedule (daily) | Fetch `/api/v1/cron/reliability-report` and post a summary (success rate, anomalies, SLO breaches) to Slack if configured. |
| `execution-analyzer.json` | Execute Workflow | Collect sanitized execution metadata (no item data) from the n8n API for a given execution id. |

Investigation, recovery planning and approvals deliberately run **inside Loopmend**, not n8n: approvals are human decisions recorded in Loopmend's audit log, and n8n is never the authorization authority.

## Import

```bash
docker compose -f infrastructure/docker/docker-compose.yml exec n8n sh -c 'for f in /workflows/*.json; do n8n import:workflow --input="$f"; done'
```

Then in the editor:
1. Set **Loopmend · incident-ingestion** as the *Error Workflow* (Workflow settings) of every workflow you want monitored.
2. Activate **recovery-executor**, **health-monitor** and **reliability-reporter**.
3. Point Loopmend's `N8N_WEBHOOK_URL` at `https://<n8n-host>/webhook/loopmend-recovery`.

To regenerate a test failure, create a workflow with an HTTP Request node to `https://httpbin.org/status/429` and set its Error Workflow to the ingestion workflow.
