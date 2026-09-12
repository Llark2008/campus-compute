# Expanded ARC-Challenge test dataset implementation

Date: 2026-09-12

## Outcome

Campus Compute now includes the complete 1,172-row `allenai/ai2_arc` `ARC-Challenge` test split as a second bundled dataset. The original fixed 200-question validation dataset and its two train examples remain unchanged.

The coordinator imports the bundle as `ARC-Challenge · 1,172 test questions`. Its source, revision, and license are read from the checked-in lock. The import is additive and optional: startup skips it when both bundle files are absent, imports it when both are present, and fails clearly when only the JSONL or lock is present. Invalid lock JSON or invalid dataset content is not suppressed.

## Source and acquisition

The source is [allenai/ai2_arc](https://huggingface.co/datasets/allenai/ai2_arc), configuration `ARC-Challenge`, split `test`. The refresh path requests the Hugging Face dataset viewer rows endpoint in 12 pages of at most 100 rows, at offsets 0 through 1100.

Each page must report `num_rows_total: 1172` and `partial: false`, contain the exact expected number of rows, have contiguous `row_idx` values, and report no `truncated_cells`. The combined rows must total 1,172 and have 1,172 unique IDs. Any mismatch stops generation before the new artifacts are written.

The explicit refresh completed on 2026-09-12 at `2026-09-12T13:30:35.097Z` and returned all 1,172 rows. The downloaded raw rows are retained in `data/arc-test-source.snapshot.json`.

License metadata uses the existing display form `CC BY-SA 4.0` and also records the SPDX identifier `CC-BY-SA-4.0`.

## Reproducibility and normalization

`npm run prepare:data:test` performs an offline rebuild. It reads the stored snapshot and lock, validates the source identity, page URLs, counts, license, snapshot hashes, revision, deterministic order, and locked dataset hash, then regenerates only `data/arc-test.jsonl`. It does not contact the network or change `downloadedAt` or provenance.

`npm run prepare:data:test -- --download` is the explicit network refresh. It downloads and validates all 12 pages, writes the raw snapshot, normalizes the data through the production `parseJsonl` pipeline, and replaces the test lock with content-addressed provenance.

Rows are ordered by ascending `hashJson([42, id])`. Although all 1,172 rows are included, this fixes a deterministic question order for runs and places the ordered IDs in the lock. With three prompt variants, a full experiment plans 3,516 jobs.

Pinned content identifiers:

- Dataset JSONL SHA-256: `0f846a8ceb817a24ec58e55d6c87ecfe9b5439cf6cd1eb6fadd0f2279711090d`
- Raw snapshot canonical SHA-256: `ca9c6326c1b31cc0f0186f007ba5f9ef1041e097f58dd4c424cff80a5e5b418e`
- Raw snapshot file SHA-256: `a70bc85bc1370c2d094ddefdbef3893deb6dc6262d229fe240fe7b229b325086`
- Revision: `viewer-snapshot:ca9c6326c1b31cc0f0186f007ba5f9ef1041e097f58dd4c424cff80a5e5b418e`

The JSONL is 482,178 bytes, below the 2,000,000-byte dataset limit.

## Legacy artifact preservation

The integrity test pins all four existing artifacts byte-for-byte:

- `data/arc-demo.jsonl`: `6a86d0dd25163f080279e89fc6ce5654ce0dc2790408fc51cee5a7c2cf9ac5cc`
- `data/arc-examples.json`: `42df7940939b0454f6c9bed73670bbb458a15644e948602a227dd4943d04ace3`
- `data/arc-source.snapshot.json`: `53c15c12e3b4ea897caedd212564787d78f00b2c660ddb23c58ec193f14905fe`
- `data/dataset.lock.json`: `9fcff11ea742108af5b19b99d54e2162c951566155c738603cf1a8bc4398f6a6`

The new test IDs have no overlap with any of the 299 original validation rows or the two fixed train examples.

## Verification

The data test was first run before implementation and failed because the three `arc-test` artifacts did not exist. A second failing test demonstrated that the first preparation implementation attempted a network request by default. The final implementation passes both regression cases.

Fresh verification on 2026-09-12:

```text
node_modules/node/bin/node node_modules/vitest/vitest.mjs run tests/core/arc-test-data.test.ts tests/core/data.test.ts
Test Files  2 passed (2)
Tests       6 passed (6)

node_modules/node/bin/node node_modules/typescript/bin/tsc --noEmit
exit 0
```

The explicit download command also completed successfully with 12 pages, 1,172 downloaded rows, 1,172 selected rows, and the pinned revision above. Running the offline command afterward reproduced the JSONL without changing the lock.
