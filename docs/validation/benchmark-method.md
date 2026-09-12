# Benchmark method

Status: harness implemented; real physical-pool measurements pending. Do not calculate or claim a speedup from the local functional reports.

Use a separate coordinator database, fixed model/runtime lock, fixed ARC questions/prompts, and at least two physical devices. Preload/warm each native model. Keep each owner's chosen contribution level, foreground activity, power connection and network fixed throughout the paired conditions. Identify the strongest single device from prior actual single-device measurements.

The script executes three rounds of each condition in alternating order:

1. Strongest single device, dynamic pulling.
2. Same complete pool, dynamic pulling.
3. Same complete pool, static task allocation.

All runs use benchmark mode: cache reads/writes and credits are disabled. The coordinator holds the tasks until each selected worker reports a fresh ready heartbeat, then releases the batch together. Measure end-to-end makespan from coordinator start to completion; retain the raw report for every run.

Reject a run from speed comparison if it has incomplete/failed/canceled jobs, any nonaccepted or repeated attempt (including an intentional release), changed contribution levels or the wrong participating devices. Retain rejected/interrupted reports with their reason. Ratios are only reported when all three valid repetitions exist for each compared condition.

Report per-condition medians and the individual observations. Single/dynamic measures benefit from aggregate capacity; static/dynamic isolates the scheduling comparison. If the dynamic pool is not faster, preserve that result. The baseline has one inference at a time; this does not establish superiority to an optimized batched GPU server.

The local ten-task low/medium/high checks validate owner duty cycles. They are not the nine-run performance comparison. The600-task report records true model work but was collected during development on one physical computer.

Run configuration and commands are in [the runbook](../runbook.md). Physical event network checks and two timed three-minute rehearsals remain to be performed with the team.
