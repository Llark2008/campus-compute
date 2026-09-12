# Real Replay Showcase Implementation Plan

> Execute inline in the current non-Git workspace; the user explicitly requested this implementation. Preserve running workers and coordinator.

**Goal:** Present the real join_and_out run as an interactive and offline-capable judging demonstration.
**Architecture:** A pure event/frame replay model feeds React presentation components. Vite bundles the presentation and embedded recording into a standalone HTML also served by the existing coordinator.
**Tech Stack:** Existing React 19, TypeScript, Vite, Vitest; no new runtime dependencies.
**Spec:** docs/superpowers/specs/2026-09-12-replay-showcase-design.md

## Constraints

- Actual source recording only. 3000 accepted tasks, no cache, 533243 ms publication-to-finish duration.
- Default paused at time zero, 6× selected; all speed labels explicitly say replay.
- Initial state must exclude future devices. Departed devices retain contributions.
- Never merge old-client sessions by name. Never fabricate interpolation of contributions or speedup.
- Offline HTML has no network dependency or credentials.

## Task 1: Deterministic replay model

Files: src/replay/model.ts, tests/web/replay-model.test.ts.
Interface: createReplay(trace:ExperimentTrace, timing?:{createdAt:number;finishedAt:number}):ReplayIndex; stateAt(index, elapsedMs):ReplayState. Index exposes startAt, durationMs, milestones, handoffs, trace; state exposes elapsedMs, progress, devices, gap and recent accepted activity.

- [x] Write failing assertions against actual source: `expect(stateAt(index,0).progress.fresh).toBe(0)`; only local-mac is initially visible; registered boundary creates optional with zero work; after departure optional is stopped with 638 contributions; final fresh and summed contributions equal 3000; real handoff is 28 ms to claim and 1016 ms to accept.
- [x] Run `node_modules/node/bin/node node_modules/vitest/vitest.mjs run tests/web/replay-model.test.ts` and confirm missing implementation fails.
- [x] Implement frame checkpoint + subsequent event reduction, deduplicating by taskId and using observed event sequence. Clamp timeline; retain gaps, initial cache and terminal outcomes; derive milestone and handoff records from event/task/lease identity.
- [x] Run focused tests; compare every source frame/cursor boundary and backward seek. Add synthetic gap/cache boundary checks.

## Task 2: Presentation and packaging

Files: src/replay/{Replay,Network,ProgressChart,standalone}.tsx, src/replay/replay.css, scripts/{build-showcase,build-web}.ts, package.json, src/web/RecordingPanel.tsx.
Interface: `<Replay trace={trace} timing={timing}/>` consumes original recording. Build writes output/showcase/campus-compute-replay.html and dist/web/showcase.html.

- [x] Build prominent progress and network scene, device contribution cards, milestone narrative, task handoff evidence and recorded progress plot.
- [x] Add timeline, play/pause/restart, speed selector, fullscreen and milestone jump controls. Use requestAnimationFrame elapsed wall time; pause on hidden tab, support reduced motion and keyboard controls without intercepting form keys.
- [x] Package inline JS/CSS/data using Vite. Escape embedded data and script closers. No credentials or remote requests. Link showcase only on the source experiment's RecordingPanel.
- [x] Run typecheck and production build, then existing relevant tests and new model tests.

## Task 3: Browser QA and delivery

Files: docs/replay-showcase.md, docs/validation/replay-showcase.md, output/playwright/replay-*.png.

- [x] Open real page. Verify 0/3000 and one device initially; jump to joins, departure/handoff, and end. Verify exact final 1769/638/593 values and paused seek stability.
- [x] Verify replay controls, speed, fullscreen, responsive 1440/1280/390 widths, console, and offline file opening.
- [x] Review for future-data leakage, incorrect connected device counts, double-counted results, stale contributions after seek and misleading motion.
- [x] Save screenshots and concise operation guide; open final showcase for user.
