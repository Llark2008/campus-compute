# Evaluation Comparison Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans for the bounded tasks. Checkboxes track this extension.

**Goal:** Support a larger real question set, comparable durations and per-experiment contributor lists, with usable exports and a judge demo guide.
**Architecture:** Extend the existing SQLite snapshot/report and additive pool discovery API. Keep worker protocol, native model and stored evaluation records compatible. Add a separately versioned ARC test dataset and configurable prefix selection.
**Tech Stack:** Existing Node24/TypeScript/Fastify/SQLite/React/Vite/Vitest.

## Task1 — real data expansion (independent delegate)
Files: new scripts/prepare-arc-test.ts, data/arc-test.jsonl, data/arc-test-source.snapshot.json, data/arc-test.lock.json, tests/core/expanded-data.test.ts; src/server/main.ts optional builtin import; package.json script only.
- [x] Write failing checks for1172 unique test rows with hashes, stable ordering, no train-example or validation overlap.
- [x] Download official ARC-Challenge test rows, validate complete1172 count and no truncated cells; deterministic sha256([42,id]) ordering; preserve existing200 files.
- [x] Generate fixed raw JSONL/snapshot/manifest; script supports reproducible rebuild from stored snapshot (network refresh explicit).
- [x] Import additional dataset on startup if its bundled data/manifest exist; preserve old dataset config/import.
- [x] Run data tests. Parent owns maxSamples=2000 and shared schema limit.

## Task2 — timings and contributor scope (root)
Files: src/shared/contracts.ts, src/server/report.ts, store.ts, app.ts; scripts/benchmark.ts; tests/core/report.test.ts and integration/benchmark.test.ts.
- [x] Add failing clock tests and contributor/cache/other-experiment tests.
- [x] Add createdAt/elapsedMs/executionElapsedMs/workloadFingerprint; compute with same coordinator clock and frozen end.
- [x] Filter snapshot workers to fresh accepted contributors and limit global lifecycle events to those who actually attempted this experiment.
- [x] Add independent authenticated GET /api/workers for currently connected pool status; migrate benchmark readiness and level tracking.
- [x] Run scoped core/benchmark tests.

## Task3 — selection, timing display and comparison export (root)
Files: src/shared/limits.ts,schemas.ts; src/web/Publish.tsx,Experiment.tsx,view-model.ts,styles.css; tests/web/view-model.test.ts and new report-export tests.
- [x] Lift sample cap to2000; replace quick20 boolean UI with validated count selector/presets.
- [x] Display frozen/running total and execution time with clear definitions.
- [x] Add safe CSV summary export using timing/count/model/workload identity; compatible handling of existing archived JSON.
- [x] Update UI tests, production build and browser checks.

## Task4 — review and delivery
- [x] Independent spec compliance and code-quality review; fix concrete findings.
- [x] Run all tests, tsc and production build; verify1172/full3516-task preview without executing a large user workload.
- [x] Check live pending work, restart only owned coordinator, verify old report/new dataset; refresh client bundle with no secrets.
- [x] Write judge demonstration/testing guide and explain measurement limits. Record exact validation. No commits/PRs because workspace is not a Git repository.


## Execution notes
- No Git repository exists, so this extension runs in the already authorized shared workspace; no branch/commit/PR operations.
- Plan review required preserving benchmark release `startedAt` and using earliest attempt for execution timing; implemented and tested.
- Pool readiness uses independent authenticated `/api/workers`, while level validation also checks departed experiment contributors.
- Dataset implementation and independent final review approved. Identical offline rebuild is now a no-op to avoid rewriting shared data.
