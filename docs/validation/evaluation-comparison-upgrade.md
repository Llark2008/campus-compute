# Evaluation comparison upgrade — 2026-09-12

Implemented and independently reviewed: complete1172-question ARC-Challenge test dataset, validated question prefix selection up to2000 custom questions, total and execution elapsed time, experiment-scoped accepted contributors, authenticated independent connected-worker endpoint, benchmark pool-readiness compatibility, CSV summary export, legacy-report compatibility, and judge testing guide.

Validation:
- Final complete suite: **100 tests passed,21 files** (`node_modules/node/bin/node node_modules/vitest/vitest.mjs run`, local HTTP permission enabled).
- TypeScript `--noEmit`: passed.
- Production Vite build: passed,35 modules.
- Official dataset:1172 unique questions,12 complete untruncated pages, deterministic seed42 rank; original200 validation artifacts remain byte-identical. Dataset integrity and offline rebuild included in tests.
- Red/green regressions cover queue/dispatch/finish/cancel timing, all-cache no-execution time, held benchmark first dispatch, old-worker and later-event exclusion, workload identity, authenticated connected pool, departed contributor level changes, invalid counts, CSV quoting/formula prefixes and old reports without metadata.
- Coordinator restarted with zero queued/leased tasks, existing database preserved; both bundled datasets available after restart. Worker processes were not restarted.
- Live existing600-task report:600 fresh,0 cache; total450.019s,execution449.871s. Contributor counts11+167+422=600, only the three actual contributors. This is an existing functional run, not a controlled speedup measurement.
- Browser export: existing report CSV downloaded successfully and parsed as one comparison row; total450.019s/execution449.871s/3 contributors match coordinator. Browser console:0 errors,0 warnings.
- Browser preview:1172 questions×3 prompts=3516 tasks, all3516 fresh,0 cache; no large workload submitted during verification.

Independent spec and final code-quality review approved. The final review's optional shared-data rewrite concern was addressed: offline rebuilding identical data does not rewrite/truncate the dataset file.

No physical-pool benchmark was performed for this extension. The elapsed time on an old development run cannot establish a single/multi-device speedup, energy savings, or a fourfold improvement. See `docs/judge-testing-guide.md` for controlled comparisons and demo procedure.
