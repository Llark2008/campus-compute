# Experiment Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for bounded independent work and review.

**Goal:** Persist enough truthful process data to render and replay experiment progress and dynamic device participation.
**Architecture:** Add SQLite recording tables and a focused server recorder hooked into existing event/finish/sweep operations. Add an optional durable native device identity and an authenticated export consumed by a small web panel.
**Tech Stack:** Existing Node24, TypeScript, SQLite, Fastify, React/Vite/Vitest.
**Spec:** docs/superpowers/specs/2026-09-12-experiment-recording.md

## Global Constraints
- Existing model, engine, lease semantics, credits and accepted-contributor filtering stay compatible.
- New experiments auto-record; legacy histories unavailable, no fake reconstruction.
- Coordinator times,2,000ms frames, explicit restart gaps, immutable completed traces.
- Pool roster scope and experiment contribution scope remain distinct.
- No credentials in traces or shared archive; no Git repository.

## Task1 — native persistent identity (bounded delegate)
Files: src/worker/device-identity.ts,main.ts,runner.ts; tests/worker/device-identity.test.ts and runner.test.ts as needed.
- [x] Red/green tests durable opaque UUID saved within stateDir; reuse after restart; malformed identity not silently replaced.
- [x] Load identity only after acquiring single-instance lock. Pass optional deviceId into runner and include it on every registration from that installation.
- [x] Keep older tests/callers compatible. Parent owns Registration type/schema optional field.
- [x] Scoped identity/runner tests and implementation report; no other files or subagents.

## Task2 — persistent recorder and lifecycle (root)
Files: shared contracts/schemas/limits; server schema.sql,recording.ts,db.ts,experiments.ts,leases.ts,store.ts.
- [x] Add failing trace tests for roster/zero contribution/events/frames/gaps/legacy.
- [x] Implement additive tables and recorder start/event/frame/end/export/status operations with sanitized session metadata.
- [x] Hook experiment create and Context event/finish; append observed heartbeat transitions. Capture due frames from store.sweep; mark restart gaps and close checkpoints.
- [x] Run scoped tests and fix findings.

## Task3 — API/web export (root)
Files: server/app.ts; web/RecordingPanel.tsx,Experiment.tsx,styles.css; API/web tests.
- [x] Add authenticated trace endpoint and recording status in snapshots; legacy unavailable.
- [x] Add recording status and Export replay JSON control with proper stale-request cleanup/error handling.
- [x] Verify scoped API/UI behavior and build.

## Task4 — independent review and delivery
- [x] Spec and code-quality reviews, fixes, full tests/typecheck/build.
- [x] Check current queue; deploy without interrupting active work. Verify recorder live with controlled temporary/isolated functional workload, not a large user pool job.
- [x] Browser checks, documentation/recording schema guide, refreshed clean client archive.

## Ledger
- User approved the proposed process recording in chat; this plan refines that authorization without another approval gate.
- Parent owns shared recorder interfaces. Delegate only owns native identity files, avoiding concurrent source edits.
- Preflight interface: Task1 optional Registration.deviceId consumed by Task2 session metadata; root adds it before delegate runs. Task2 TraceStatus consumed by Task3; root owns both.
- No existing worktree/Git exists; skill Git-only helper/commit steps are inapplicable.

- Final verification:122tests/24files,tsc andVite build passed. Independent review approved after stale same-state heartbeat enrollment and immutable initial task metadata fixes.
- Real native observation trace:966ff90b-b149-40d3-a30e-1477f753839f,11events/6frames, no evaluation inference dispatched, stable identity across Exit/Start, High/Ready restored.
