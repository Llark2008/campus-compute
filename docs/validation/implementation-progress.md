# Implementation progress — 2026-09-11

The user confirmed that Codex performs all development. The approved design and implementation plan have been implemented in this workspace. Module letters in the original plan describe ownership boundaries, not remaining human programming assignments.

| Module | Delivery |
|---|---|
| C1 protocol/build | Shared types, strict schemas, reproducible dependency lock, Node24, TypeScript/Vite/Vitest |
| C2 data/domain | Fixed actual200-question ARC sample,2 training examples, three prompts, normalization/scoring/cache keys |
| C3 queue | SQLite transactions, renewable leases, recovery, retry budget, deduplicated results and credits |
| C4 API/report | Authenticated HTTP, import/preview/publish/cancel, live snapshots, traceable export |
| W1 engine/probe | Native owned llama.cpp, token preflight, exact runtime hashes, verified Metal and20-question probe |
| W2 lifecycle | Pull worker, independent heartbeat, contribution intervals, pause/resume, immediate exit and recovery |
| W3 local control | Native entrypoints and Mac/Windows scripts, single-instance lock, authenticated loopback control |
| U1 website | Publish, live experiment, comparison/raw answers, prior-report import and owner contribution page |
| U2 integration | Actual600-task Mac run, actual lifecycle/cache checks, protocol regression tests and benchmark harness |
| U3 delivery | README, runbook, three-minute script, raw evidence and explicit acceptance matrix |

Scoped reviews covered queue/API, worker lifecycle/native adapter, browser async state and benchmarking. Concrete findings were corrected and regression-tested. Final verification details are in [core.md](core.md).

The current accessible device is a16GB M1 Pro Mac. Windows,8GB usability, real multi-device throughput, backup networking and event rehearsal remain physical acceptance work; no measurements are invented. See [acceptance.md](acceptance.md).

This workspace was a documentation-only directory without a Git repository. No existing code/branch was overwritten; no remote repository, commit, deployment or PR was created. Downloaded weights and runtime SQLite are outside the synced project directory. Private local configuration and browser scratch output are ignored.
