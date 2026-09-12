# Real experiment replay showcase

The user authorized a dynamic webpage based on the verified `join_and_out` recording, including total progress and device joins/exits. This implements the playback, scrubbing, speed selection, and task handoff previously discussed. English presentation copy fits the three-minute judging slot; default 6× plays 533 seconds in approximately 89 seconds. No additional approval is required for this reversible implementation.

## Experience

A self-contained presentation page shows a prominent total progress bar, completed/queued/in-flight counts, elapsed experiment time, an animated coordinator/device network, contribution cards, a cumulative progress plot, and an event narrative. Device cards are only introduced at their observed join, start with zero work, remain visible with frozen contribution after leaving, and never count a departed device as connected. Use tasteful teal, warm paper and navy colors consistent with Campus Compute; device colors distinguish curves and nodes. Always label this as recorded data and display playback multiplier. The diagram expresses task activity; numeric task evidence comes from recorded events.

A bottom timeline supports play/pause, replay, scrubbing, 1×/3×/6×/12× speed, fullscreen and jumps to start, joins, departure/handoff, and completion. Space toggles playback outside form controls. Opening a page starts paused; the audience sees the initial zero state. A persistent narrative explains the latest milestone, with a dedicated evidence card for the real released/claimed/accepted task. Jumping backward restores all values deterministically, without retaining future devices or contributions.

## Sources and integrity

Source: output/recordings/campus-compute-replay-90a8719c-4f0d-41f3-b5df-13046c68faf8.json. Report start/finish timestamps provide publication-based elapsed time (533243 ms). Preserve absolute coordinator event times, event sequence, task identity, attempt identity, and initial cache status. Frames plus events after frame.eventCursor reconstruct exact task counts; accepted task IDs deduplicate contributions. Join time is coordinator registration, not the physical Start click. A latest periodic frame may show stale busy state, so activity labels use actual leased task IDs. Never display success for failed/canceled tasks. Observation gaps remain visibly marked; do not interpolate measured results through them. No speedup/energy/accuracy claim is inferred from this replay. Old-client sessions are not merged by name.

## Architecture

- src/replay/model.ts: pure deterministic replay index, stateAt, milestones and handoff evidence. Uses existing ExperimentTrace types.
- src/replay/Replay.tsx, Network.tsx, ProgressChart.tsx, replay.css: presentational UI and playback controls.
- src/replay/standalone.tsx: read embedded JSON and render the same page.
- scripts/build-showcase.ts plus scripts/build-web.ts: bundle through installed Vite into one offline HTML with inline JS/CSS/source data. Write output/showcase/campus-compute-replay.html and dist/web/showcase.html. No external fonts, images, APIs or CDNs.
- Existing experiment RecordingPanel gets an explicit link to this real recorded showcase only for this experiment ID; no backend mutation or restart required.

## Verification

Test initial zero contributions, no future devices, exact registration boundary, departure retaining contributions, real task handoff with different lease IDs, backward seeking, all 3000 unique accepted tasks, frame-cursor reconciliation and gaps. Typecheck/build; browser verify desktop/mobile layout, controls, milestone seeks, pause, end/replay, console, and file:// offline operation. Save screenshots and instructions. Preserve existing server and workers.
