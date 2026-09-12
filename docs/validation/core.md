# Implementation verification

The delivered source contains a real Node24/Fastify/SQLite coordinator, native llama.cpp worker and React web app. Production has no fake model, canned-result, remote API or fabricated-metric fallback. Test model doubles are explicitly isolated under `tests/`.

## Scope covered

- Input validation, atomic JSONL import, fixed data/provenance, label normalization and strict answer-line scoring.
- Dynamic queue competition, one active task per worker, renewed leases, expiry/recovery, retry budgets and owner cancellation.
- Idempotent result receipts/credits, output-cache reuse, changed-gold rescoring and cache-free benchmark mode.
- Actual HTTP between the SQLite service and worker client, including success, INPUT_TOO_LONG, task release and leave/session invalidation.
- Native adapter input budgeting, exact model/binary/template hashes, model ownership, authenticated local HTTP and actual Metal execution.
- Independent heartbeat, late-response races, contribution intervals, pause/resume, owned-process exit, startup cancellation and single-instance locking.
- Browser API handling, imported report structure/row joins, asynchronous response guards and production bundle generation.
- Benchmark readiness barriers, repeated/failed/released-attempt exclusions and preservation of invalid reports.

## Integration findings resolved

Independent review found two different fault/acknowledgement shapes between the HTTP client and server. The client now uses `/api/tasks/:id/error` and validates200 `{ok:true}` for fault/release/leave. A real HTTP/SQLite regression verifies the corresponding permanent failure, requeue and session invalidation.

Repeated full-suite testing also reproduced a shutdown hang. Diagnostics showed the worker had stopped, zero active HTTP requests, and one TCP connection with zero bytes read/written. It was an idle speculative connection, not unfinished inference. Coordinator shutdown now closes its owned connections. Deterministic idle-socket and stalled partial-request tests accompany this change. Temporary stress expansion and diagnostic logging are removed from the delivered suite.

The earlier15s/25s integration timeouts are retained here as investigation history; increasing the test timeout alone did not resolve the issue. The work deadline remains10s; after the actual socket cleanup fix, the test uses the normal suite timeout again.

## Actual hardware and browser evidence

[Acceptance](acceptance.md) links the native20-question probe, the full600-result evaluation, contribution/lifecycle checks and the actual coordinator-restart check. The HTML controls were exercised in Chrome, including publishing the real batch, native start, live results, raw-answer exploration and JSON download. The downloaded JSON was parsed and checked for600 rows and200 samples.

No real Windows,8GB foreground-use or physical-pool benchmark is claimed. The real local records are functional evidence and are unsuitable for a controlled speedup claim.

## Final commands

Run `npm test`, `npm run typecheck`, and `npm run build:web` from the project root. Final verification completed with **83/83 tests passing across18 files**, zero failures; TypeScript checking and the production build both exited0. Machine-readable results are in [automated-checks.json](automated-checks.json). The project has no existing Git repository; no commit, push, PR or deployment was performed.
