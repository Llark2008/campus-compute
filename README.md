# Campus Compute

A small, recoverable inference pool for student AI developers. Publish a batch of prompt evaluations, let trusted Mac and Windows computers pull independent questions, and compare traceable answers. Each contributor controls their own pace and can pause or leave.

The final internal test and recorded demonstration run Qwen2.5-1.5B-Instruct Q4_K_M on **1,000 distinct ARC-Challenge test questions × 3 prompt variants = 3,000 independent inference tasks**. One task evaluates one question with one prompt variant. Every device loads the same complete model and processes assigned tasks independently.

| Final internal test | Count |
| --- | ---: |
| Distinct questions | 1,000 |
| Prompt variants per question | 3 |
| Planned inference tasks | 3,000 |
| Fresh results accepted | 3,000 |
| Cached results / failed tasks | 0 / 0 |

The [recorded source data](data/showcase/join-and-out.json) retains the question IDs, prompt IDs and task events for this run.

- [Setup and operation](docs/runbook.md)
- [Final internal test and replay verification](docs/validation/replay-showcase.md)
- [Earlier single-device validation](docs/validation/acceptance.md)
- [Three-minute demo](docs/demo-script.md)
- [Approved design](docs/superpowers/specs/2026-09-11-campus-eval-design.md)
- [Implementation progress](docs/validation/implementation-progress.md)

## Stack

Node24 / TypeScript, Fastify, SQLite, React/Vite and native llama.cpp. A pull queue uses renewable leases, transactional result deduplication and local model processes. Prompt outputs are cached independently of gold labels; benchmark runs bypass caching and credits.

```sh
npm ci
npm run build:web
npm test
```

Follow the runbook to provision the exact model and engine, generate a real runtime lock, then start a coordinator and a worker. No model/API fallback is simulated in production. Test fixtures are isolated under `tests/`.

## Scope

Trusted campus groups; local owner control; a single coordinator; one inference at a time per physical device. Native Windows code is included, but supported backends and actual speedup claims depend on the recorded real-device checks. Extra inference consumes energy; no unmeasured energy saving or speedup claim is made.

## Sources

Data: [AI2 ARC](https://huggingface.co/datasets/allenai/ai2_arc), CC BY-SA 4.0, modified by fixed validation selection and label normalization. Provenance and hashes are retained in `data/dataset.lock.json` and `data/arc-source.snapshot.json`.

Model: [official Qwen GGUF](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF). Engine: [llama.cpp](https://github.com/ggml-org/llama.cpp). The model and engine retain their upstream licenses; model weights are not stored in this repository.

## Final internal verification

The completed `join_and_out` run evaluated **1,000 questions using 3 prompts, producing 3,000 accepted inference results** in 533.243 seconds. The three devices contributed 1,769, 638 and 593 accepted tasks. Two devices joined after the start, and one left while work remained. Its released task was claimed by another device after 28 ms and accepted 1.016 seconds after release. These are observations from this run, not a controlled speedup measurement. See the [source recording](data/showcase/join-and-out.json) and [verification notes](docs/validation/replay-showcase.md).

Earlier development checks used 200 validation questions × 3 prompts = 600 tasks on one Mac. Their [raw results](docs/validation/real-evaluation-local-mac.json) and [acceptance details](docs/validation/acceptance.md) remain as historical evidence. They are separate from the final 1,000-question / 3,000-task internal test.

## Expanded evaluations and judge testing

The coordinator bundles an earlier 200-question validation set and the full 1,172-question ARC-Challenge test set. The final internal test selects 1,000 questions from the test set; the library size and the selected experiment size are different. Select a question count, inspect elapsed time and export comparison CSV from a report. See [the judge testing guide](docs/judge-testing-guide.md) for cache-free comparisons and the three-minute demo.

New experiments automatically record pool participation, task events and2-second progress frames. Use **Export replay JSON** on the experiment page. See [process recording](docs/process-recording.md) for the schema, device identity and join/exit test procedure.

## Recorded experiment showcase

Open `http://localhost:3000/showcase.html` for the real join/exit replay, or use the standalone `output/showcase/campus-compute-replay.html` offline. See [presentation controls and 3-minute walkthrough](docs/replay-showcase.md).
