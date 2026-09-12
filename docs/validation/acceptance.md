# Acceptance record — 2026-09-11 (America/New_York)

> Historical single-device validation: this document describes the earlier 200-question / 600-task run. The final internal test used **1,000 questions × 3 prompts = 3,000 tasks**; see [current replay verification](replay-showcase.md) and [source recording](../../data/showcase/join-and-out.json).

The application is implemented and locally exercised. Physical cross-platform/pool acceptance is **not complete**. This record distinguishes automated protocol checks, real native execution, and checks requiring other hardware.

Final automated checks: **83/83 tests passed**, with TypeScript checking and production build passing.

## Actual evidence

- [Native 20-question probe](probe-local-mac.json): Apple M1 Pro,16GB RAM, macOS arm64, Metal. Official llama.cpp b10917; 29/29 layers offloaded. This does not validate an8GB device.
- [Complete real evaluation](real-evaluation-local-mac.json):200 ARC questions ×3 prompts; **600 newly computed results,0 cached,0 failed,0 fault retries,600 credits**. Full inputs, outputs, attempts, scores and public runtime hashes are retained.
- [Real lifecycle and duty-cycle evidence](lifecycle-local-mac.json):600 cache hits without new credits;10 real jobs at each contribution level; pause/resume preserves the model process; active exit measured **825.6ms**, confirmed process gone and task queued; restarting finishes the released work.
- [Recovered evaluation](real-lifecycle-evaluation.json):40 fresh results,0 failures,40 credits;41 attempts because one task was intentionally released.
- [Final native smoke check](final-native-smoke.json): after the client protocol fix, an intentionally overlong input was reported as INPUT_TOO_LONG, the next20 ARC tasks completed, and the model process exited cleanly.
- [Restart evidence](restart-local-mac.json): an actual coordinator restart retained the completed600-task evaluation.
- Browser exercise: login, preview/publish, start a native contributor, live progress, per-question reports. Screenshots are in `output/playwright/`.

The600-task run is functional evidence on one computer while development tools were also running. Its elapsed time is **not a controlled performance benchmark or a multi-device speedup measurement**. `coldStartMs` in the probe measures a fresh engine process; OS file caches had already been warmed during setup.

## Approved acceptance checklist

| ID | Status | Evidence / remaining work |
|---|---|---|
| A01 import/publish | Passed locally | Real webpage published600 jobs; automated invalid-line/atomic-import tests |
| A02 normalization/scoring | Passed automated | Numeric labels, strict answer lines, invalid labels and truncation cases |
| A03 Mac+Windows native inference | Partial | Mac20-question probe and600-task run pass; Windows hardware unavailable |
| A04 8GB everyday use | Pending physical device | Requires10minutes of normal foreground work, memory-pressure measurements and owner feedback |
| A05 dynamic claiming | Passed protocol; physical pool pending | SQLite concurrency/one-lease checks; actual cross-device joining still required |
| A06 contribution levels | Passed locally |10 real tasks per level; recorded acknowledgement-to-next-claim gaps satisfy2t/t/0 |
| A07 pause/resume | Passed locally | Current task finishes, no new claim for2.1s, resume uses same owned PID |
| A08 immediate exit | Passed locally |825.6ms; process confirmed gone, interrupted task queued without a fault retry |
| A09 sudden disconnect | Passed automated; physical pending | Lease expiry/reassignment tests; actual second-device recovery and timing unmeasured |
| A10 deduplication/races | Passed automated | Receipts, stale leases, cancel/result competition and repeated submissions |
| A11 cache/rescore | Passed locally + automated |600 real cache hits; automated changed-gold rescoring and changed-input cache miss |
| A12 errors/recovery | Passed automated | Input limits, retry budgets, persisted queue/restart and terminal reporting; HTTP fault regression included |
| A13 credits | Passed locally + automated |600/600 and40/40; cached and benchmark jobs add no credit |
| A14 traceable reports | Passed locally + automated | Raw600-row export, shared200-question denominator and browser answer details |
| A15 cross-device consistency | Partial | Real local hashes and20 outputs retained; Windows/other-Mac output comparison pending |
| A16 network/owner access | Partial | Local HTTP, authenticated owner control and Host/Origin checks; event/backup network pending |
| A17 controlled benchmarks | Pending physical pool | Nine-run harness and invalid-run checks implemented; no real multi-device results |
| A18 three-minute rehearsal | Pending event rehearsal | Script prepared; no timed mixed-device rehearsal claimed |

## Interpreting the actual scores

For the common200-question set, prompt B produced200 valid answer lines and145 correct answers (72.5%). Prompt A produced0 valid answer lines; prompt C produced14 valid answer lines and12 correct answers. These are **strict generated-answer scores**, not published ARC model benchmark accuracy. A semantically correct response such as `C. River sediments…` fails the required `ANSWER: C` format. Original text remains available for inspection; the scorer was not changed to improve the results.

See [current limitations](limitations.md), [device inventory](devices.json), [benchmark method](benchmark-method.md), and [implementation verification](core.md).
