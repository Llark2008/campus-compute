# Campus Compute

A small, recoverable inference pool for student AI developers. Publish a batch of prompt evaluations, let trusted Mac and Windows computers pull independent questions, and compare traceable answers. Each contributor controls their own pace and can pause or leave.

The built-in case runs Qwen2.5-1.5B-Instruct Q4_K_M against a fixed 200-question ARC-Challenge validation sample with three prompt variants: **600 independent inference tasks**. Every device loads the same complete model. This is task parallel inference, not model sharding or training.

- [Setup and operation](docs/runbook.md)
- [Validation and remaining hardware checks](docs/validation/acceptance.md)
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

## Local verification

On a16GB Apple M1 Pro Mac, the actual native model completed all600 default tasks with0 execution failures and600 credits. Real low/medium/high, pause/resume, cache reuse and active-process exit were also exercised. [Raw results](docs/validation/real-evaluation-local-mac.json) and [acceptance details](docs/validation/acceptance.md) retain the evidence. This is single-device functional validation; Windows,8GB usability and real multi-machine speedup remain unverified.

## Expanded evaluations and judge testing

The coordinator now bundles both the original200-question validation set and the full1,172-question ARC-Challenge test set. Select a question count, inspect elapsed time and export comparison CSV from a report. See [the judge testing guide](docs/judge-testing-guide.md) for cache-free comparisons and the three-minute demo.

New experiments automatically record pool participation, task events and2-second progress frames. Use **Export replay JSON** on the experiment page. See [process recording](docs/process-recording.md) for the schema, device identity and join/exit test procedure.

## Recorded experiment showcase

Open `http://localhost:3000/showcase.html` for the real join/exit replay, or use the standalone `output/showcase/campus-compute-replay.html` offline. See [presentation controls and 3-minute walkthrough](docs/replay-showcase.md).
