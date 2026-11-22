# Benchmarks

Measured, repeatable numbers only. Run them yourself with `npm run bench` (see `infrastructure/scripts/benchmark.ts`). Raw results are in [`results/`](results).

## Ingestion — 2026-11-22

**Setup:** production build (`next start`, one Node.js process) → Postgres 16 in Docker on the same laptop
(Intel i5-8265U, 8 cores, 8 GB RAM, Node 24). DB pool size 10. Seeded demo data (~4,000 executions) present.
Webhook rate limit lifted (`WEBHOOK_RATE_LIMIT_PER_SEC=100000`) to measure capacity rather than the limiter.

Each request is a full production path: HMAC verification → nonce insert (replay protection) → payload
normalization → one transaction claiming the idempotency ledger, upserting workflow + execution,
correlating/creating the incident (per-org counter), incident event and audit record.
1,500 unique events per run across 25 workflows × 4 error signatures, after a 50-request warm-up.

| Concurrency | Throughput | p50 | p95 | p99 | Max | Errors |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 21.8 events/s | 44 ms | 62 ms | 79 ms | 118 ms | 0 / 1500 |
| 10 | 45.0 events/s | 213 ms | 293 ms | 361 ms | 1068 ms | 0 / 1500 |
| 25 | 48.0 events/s | 495 ms | 681 ms | 800 ms | 1667 ms | 0 / 1500 |

**Ingestion delay** (event `occurredAt` → incident committed and acknowledged) equals request latency, because
ingestion is synchronous: p95 62 ms at concurrency 1.

**Duplicate behaviour:** in every run, the same event delivered 50 times concurrently (fresh nonce each time)
produced **exactly 1 incident**; the other 49 deliveries returned `duplicate` with the same incident id and no errors.

**Interpretation:** a single instance on this hardware saturates around 45–50 events/s; beyond that, extra
concurrency only adds queueing latency (no errors, no duplicates). Per-event cost is dominated by the
transactional write path and the row lock that serializes recurrences of the same incident. Horizontal scaling
(more Vercel function instances) and the Supabase pooler raise the ceiling; this has not been measured yet.

## Not yet measured
- Recovery success rate against a live n8n instance (the demo uses a clearly-labeled simulated executor).
- Multi-instance throughput on Vercel + Supabase.
