# Browser validation

The React app is implemented against the real coordinator and loopback worker API. Coordinator controls cover group access, dataset import, workload preview/publish, live snapshots, owner cancellation, common-sample prompt comparison, raw answers and JSON export/import. The separate local contribution page controls only its own native worker.

Actual Chrome checks on this Mac:

- Group access,200-question/three-prompt preview, publish600 genuine inference jobs.
- Local contributor set to high and started through its real webpage; dashboard task counts advanced with actual Metal results.
- Completed state shows600 fresh,0 cached,0 failed and600 credits. It shows completion instead of a waiting ETA after the run ends.
- View answers opens the real report; original model text, expected/parsed answer, correctness, format and Metal backend are rendered for the selected question.
- Export JSON downloaded the completed report. The saved source report is `real-evaluation-local-mac.json`.
- Coordinator was stopped and restarted; browser polling reported interrupted connectivity and subsequently recovered the persisted600-result run.
- Initial favicon404 was fixed with a bundled inline icon. Expected connection-refused console entries occurred while the coordinator was deliberately stopped; no application JavaScript exception was observed.

Screenshots are under `output/playwright/`. They contain real local results, not manufactured demonstration data.

Automated web tests cover API error handling, payload validation for imported reports, common-count/row joins, and guards against late asynchronous results. The final aggregate commands/results are recorded in [core.md](core.md).

Remaining manual device checks: keyboard-only walkthrough, all malformed/oversized upload cases in the UI, prior-report JSON round-trip, display scaling on the actual projector, and Windows/browser combinations. Protocol/schema cases already tested automatically do not replace this device matrix.
