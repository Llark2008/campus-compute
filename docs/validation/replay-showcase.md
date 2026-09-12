# Replay showcase verification — 2026-09-12

Implemented the user-authorized dynamic webpage from the verified join_and_out recording. Served at /showcase.html and packaged as an offline HTML. Source event data is unchanged; timing comes from the saved experiment report.

## Automated checks

- 130 tests passed across25files, including8new replay model cases. TypeScript noEmit passed; original UI and standalone Vite builds passed.
- Source-based checks: initial zero; no future device cards; exact join boundary and zero contribution; departure retaining638credits; final3000fresh/results and1769/638/593contributions; rewind restores initial state; every progress checkpoint reconciles with accepted event counts; source immutability.
- Synthetic boundary check: initial cached tasks receive no device credit; gap remains marked and chart segments do not cross it.
- Independent code review and scoped re-review approved. Completion timestamps and retained handoff evidence are distinct, and READY/DONE nodes do not animate as computing.

## Real browser checks

- Joins:317freshresults at second join,1174at third join; incoming devices start at0. Departure:2245fresh, optional retains638, connected count drops from3to2.
- Handoff: optional→cindy-mac;28ms to claim and1.016s from release to accepted. The final count is3000and all device totals match the report.
- Play/pause, backward seeking, replay from end,6×/12× selection, keyboard timeline seeking, and automatic end stopping verified.
- The timing check initially failed: React could defer a state updater until a mutable previous-frame timestamp had advanced. Capturing the frame delta before queuing the updater fixed it; the browser regression then passed.
- Fullscreen entered and exited successfully.1440×900and1280×720fit both horizontally and vertically.390pxmobile width has no horizontal overflow; its stacked layout scrolls.
- Opened the standalone file via file:// with the browser network forced offline: initial and final states rendered, all3000results accessible. Reset worked offline.
- Console:0errors,0warnings. Screenshots in output/playwright/replay-wide-handoff.png, replay-720p-complete.png, replay-mobile.png and replay-offline.png.

No real evaluation was started, canceled or modified while building this replay. Existing coordinator and worker processes were left running. This webpage presents recorded results; it does not claim a controlled speedup, energy saving, CPU utilization measurement or answer accuracy.

## Requested presentation refinement

Removed the Work adds up chart. Total progress now uses one segment per observed device, with widths relative to all3000tasks and matching card colors. The bar retains the departed device's accepted contribution. Added24×/48×/96×, default24× (~22seconds).

Verification:8replay model tests and TypeScript passed; standalone rebuilt. Browser verified the intermediate1302/638/305and final1769/638/593segments, distinct colors, widths summing to100% at completion, reset hiding future devices, and720p layout fitting. Played the full run at96× in the expected4.5–8second window and verified all3000results. Console:0errors/0warnings. Screenshots:replay-colors-wide.png and replay-colors-720p.png.
