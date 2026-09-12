# Experiment process recording

User approved adding the process recording described in the preceding discussion: initial devices including zero contributors, device joins/exits/offline/recovery, task transitions, timestamped snapshots, and complete export for a later replay webpage. This implementation delivers recording and export; it does not build the future animated replay player.

## Decisions

- Automatically record new experiments from publication until completion/cancellation; preserve initial and terminal frames. Use coordinator Unix milliseconds and monotonically increasing event sequence numbers. Polling interval is2,000ms; task and observed device transitions are persisted immediately in existing transaction boundaries.
- Record the **group pool during the experiment**, including initially connected sessions and any session that appears later, even if it never claims or completes a task. Exclude unrelated stopped/offline sessions from the initial roster. Device contribution/credits/task IDs remain scoped to the experiment. Keep the existing accepted-contributor table unchanged.
- Capture registrations, explicit leave, heartbeat-loss offline, observed state/level changes and heartbeat recovery. These are coordinator-observed times; registration occurs after model warmup, heartbeat states are sampled approximately every3seconds, and offline detection is approximately20seconds after the last heartbeat. Do not label observations as exact physical button times.
- Task events include task identity, latest attempt identity/state, and accepted result identity; they support reassignment without double credit. Frames include total/fresh/cache/queued/leased/failed/canceled counts and every known session's state, level, accepted count, credits and active task IDs.
- Persist traces, session metadata, events and frames in additive SQLite tables. No secrets/tokens/config paths in trace exports. No deletion or mutation of existing reports; no trace is fabricated for legacy experiments.
- A durable opaque deviceId in each upgraded Worker's local state directory connects repeated registration sessions from that Worker installation. Registration.deviceId is optional for older clients; fallback identity is per-session and explicitly labeled. Never infer physical identity from a display name. Do not copy device-id.json between computers.
- New coordinator accepts existing clients. Upgraded clients require the updated coordinator. Worker state sampling remains the existing heartbeat cadence; unchanged heartbeats do not produce duplicate transition events.
- Reopen persisted active traces after coordinator restart, append an explicit recording-gap/resume event, and retain earlier data. Keep gaps visible; do not invent frames during downtime. Close checkpoints active traces. Terminal traces stay frozen; exports/reads do not advance or backfill recording.
- Add authenticated GET /api/experiments/:id/trace and small snapshot.recording metadata. No trace for legacy run returns a clear unavailable response. Web panel indicates recording/finished/gap/unavailable and downloads a versioned replay JSON. It continues recording with browsers closed.

## Validation

Meaningful deterministic tests cover initial zero contributors, zero-work join/leave, online/offline/recovery, unchanged heartbeat deduplication, pause/level observations, scoped contributions, attempt reassignment, cache-only and canceled traces, final freezing, export auth/no credentials, reopen/gap persistence, legacy unavailable, and durable identity/re-registration. Run scoped tests first, then complete suite/tsc/build, independent reviews and browser export. Verify live platform without starting a large workload or interrupting an active user experiment. Refresh teammate archive and document exact testing steps and identity compatibility.

The workspace has no Git repository. Work in the user-authorized shared directory, with no branch/commit/PR operations and no extra approval round for the already accepted design.
