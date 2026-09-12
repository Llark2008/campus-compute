# Worker validation

Implementation status: protocol and lifecycle automation implemented. The first macOS Metal native probe passed; Windows and full lifecycle acceptance remain pending.

The automated worker suite covers llama.cpp template/tokenize/completion payloads and token budgets, authenticated engine access, exact runtime-lock hashes, owned-process start/abort/stop, coordinator response validation and cancellation, runner pause/exit/heartbeat/receipt races, and loopback control authorization plus single-instance locking. These tests use local protocol fixtures and do not establish Windows, CUDA, foreground memory pressure, or two-second process-exit acceptance.

The native evidence in `probe-local-mac.json` records 20/20 completed ARC generations with the official Qwen revision `91cad51170dc346986eccefdc2dd33a9da36ead9`, model SHA-256 `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`, llama.cpp `b10917-8ea290247`, and a measured cold start of about 856 ms. Verbose startup evidence confirms Apple M1 Pro Metal device selection and 29/29 layers offloaded to the GPU. The generated `runtime.lock.json` carries inference key `2471268eab177e5e561aec99d56f117a3481f09d720af7c687f6f2fa0a65a4c9` and the actual arm64 binary hash. This establishes the native model/Metal adapter on that device; it does not establish the remaining lifecycle or cross-platform claims.

Run the native probe only with the official pinned model and engine release:

```sh
npm run probe -- --config config/local-probe.json --lock config/runtime.lock.json --output docs/validation/probe-DEVICE.json
```

The probe exits nonzero before writing a successful lock/report if hashing, startup, engine properties, backend evidence, warmup, or any of the fixed 20 ARC generations fails. Keep `local-probe.json`, `local-worker.json`, model weights, and engine packages outside version control. A complete device report records actual hashes, engine and template provenance, backend log evidence, cold start, raw outputs, token counts, and timings.

Still required on each claimed platform/backend: inspect the generated report, run one real coordinator task, exercise pause/resume, exit during load and generation, terminal shutdown, restart, and second-instance rejection. Confirm the owned engine PID is gone and record actual exit latency. Windows CUDA and CPU are separate backend claims; an untested path stays unverified. The 8 GB Mac foreground-use observation requires at least ten minutes and a written memory/responsiveness note.

## Final local lifecycle follow-up

The later full600-task coordinator run and real contribution/exit checks are recorded in [acceptance.md](acceptance.md). On the16GB M1 Pro, all three contribution levels completed10 real jobs, pause/resume retained the model PID, and active exit took825.6ms with the process confirmed gone. Restart completed the released task. These supersede the earlier pending local-lifecycle note; Windows and8GB acceptance remain pending.

The HTTP client was also corrected to use the coordinator's `/api/tasks/:id/error` route and strict200 `{ok:true}` acknowledgements for fault/release/leave. A real Fastify+SQLite regression verifies those paths rather than relying on independently mocked endpoint shapes.
