# Three-minute demo

The final internal test uses **1,000 distinct ARC-Challenge questions × 3 prompt variants = 3,000 inference tasks**. One task is one question evaluated with one prompt. All 3,000 tasks finished with fresh results; none were served from cache.

Use the real `join_and_out` replay at `http://localhost:3000/showcase.html`, or the offline HTML built by `npm run build:web`. It is explicitly labeled as a recording. Default 24× playback completes in about 22 seconds; 48× takes about 11 seconds and 96× about 6 seconds.

| Time | Screen and narration |
| --- | --- |
| 0:00–0:20 | Start paused. “Student developers need to evaluate prompt changes repeatedly. This internal test runs 1,000 questions with three prompts each: 3,000 independent inference tasks.” |
| 0:20–0:45 | Play at 24×. Show two laptops joining, their contribution colors appearing in the progress bar, and one laptop leaving. |
| 0:45–1:15 | At completion, point to 3,000 accepted tasks and contributions of 1,769 / 638 / 593. “Leaving does not erase completed work.” |
| 1:15–1:50 | Click Task handed off. The same task moves from optional to cindy-mac: 28 ms from release to claim, 1.016 s from release to accepted result. These are this task's coordinator observations. |
| 1:50–2:25 | Explain that each device runs the complete small model and takes independent question/prompt tasks. Contributors choose their pace and can pause or exit. |
| 2:25–3:00 | Return to the completed progress bar. Explain how a shared pool can serve repeated evaluation demand. Report a speedup only if a separate, identical-workload comparison supports it. |

Primary evidence: [source recording](../data/showcase/join-and-out.json), experiment `90a8719c-4f0d-41f3-b5df-13046c68faf8`, and [replay verification](validation/replay-showcase.md). [Controls and fast walkthrough](replay-showcase.md) describe seeking, fullscreen and offline playback.

Earlier single-device development used 200 validation questions and 600 tasks. The [historical report](validation/real-evaluation-local-mac.json) remains available for inspecting generated answers; its question count and scores must not be presented as the final 1,000-question internal test.
