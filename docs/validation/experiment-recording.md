# Experiment process recording — 2026-09-12

Delivered: automatic durable recording for new experiments; initial connected roster and zero-work devices; observed joins, exits, offline/recovery, state/level transitions; immutable initial task/cache metadata; attempt-aware task events;2-second frames; terminal freezing; restart-gap markers; stable native installation identity; authenticated process JSON export and web status panel. Existing contributor filtering, ordinary JSON/CSV, model/runtime and task credit semantics remain compatible.

Validation:
- Complete test suite: **122 passed,24 files** (Node24 Vitest with temporary loopback access).
- TypeScript `--noEmit`: passed.
- Production Vite build: passed,36 modules.
- Recording suite13tests includes zero-work joins/exits, stale-heartbeat recovery before sweep, cache initial identities, state/level deduplication, same-time boundaries, cancellation task IDs, final-expiration/offline ordering, transaction rollback, restart persistence/gaps, legacy unavailable, and raw fault text exclusion.
- Native identity suite plus runner suite:17tests passed. Identity survives fresh reads/process execution and every registration from the same installation; invalid stored identity is not replaced. Startup failures after acquiring the lock release it.
- Independent plan review, implementation review and scoped re-review approved. Two recording completeness findings were reproduced with failing tests and fixed.
- Deployment observed zero queued/leased tasks. Local Worker was idle/High, exited cleanly, then restarted with durable identity and restored toHigh/Ready. Existing database and other physical Workers were preserved.
- Real local native observation check: held2-task benchmark was never released. Actual Pause/Resume/Exit/Start controls yielded11events and6frames, retained four zero-contribution sessions, and linked the local Worker's old/new sessions to one installation deviceId. Check ended by cancellation with0claimed/accepted evaluation tasks. This verifies recording of real control actions, not inference speedup or distributed reassignment performance. See recording-native-observation.json and its traceFile.
- Browser verification: the recording panel rendered correctly; Export replay JSON downloaded all 11 events and 6 frames, with parsed content exactly matching the server capture. Browser console: 0 errors and 0 warnings. Screenshot: output/playwright/process-recording.png.

Legacy experiments are not reconstructed. Old clients can still compute and appear in traces, but need the current client and a restart for durable cross-session identity. A future animation player must use coordinator-observed time and preserve explicit restart gaps; process recording is now available, the animated player itself is outside this change.
