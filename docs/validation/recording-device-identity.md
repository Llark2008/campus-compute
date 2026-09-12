# Recording device identity validation

Validated 2026-09-12 for the experiment process recording upgrade.

## Result

Each upgraded Worker installation now owns one opaque UUID at `stateDir/device-id.json`. The Worker creates the file with Node's exclusive-create flag and mode `0600`, flushes it before use, validates and reuses it on later startups, and resets an existing file to mode `0600` after successful validation. The JSON contains only:

```json
{"deviceId":"<random UUID>"}
```

The identity is generated with `crypto.randomUUID()`. It is independent of the configured display name, host name, hardware identifiers, platform, CPU description, and network address. Renaming a Worker does not alter its identity.

An existing identity must be strict JSON with one valid UUID field. Invalid JSON, an invalid UUID, extra fields, an unreadable file, or an inability to secure the file causes a clear startup error. Existing malformed content is never replaced. A missing file is the only condition that creates a new identity.

Worker startup acquires `worker.lock` before loading or creating the identity. Every subsequent registration made by that process receives the same optional `deviceId`, including a new registration after Exit followed by Start. Callers that do not supply `deviceId` to `createRunner` retain the legacy registration behavior.

The entire post-lock construction path releases the instance lock when identity loading or any later startup construction fails. The listen-failure path also closes the control server before releasing the lock.

## Files

- `src/worker/device-identity.ts`: strict load/create, UUID generation, private permissions, and explicit failure handling.
- `src/worker/main.ts`: load after single-instance locking, pass identity into the runner, and release the lock on startup failure.
- `src/worker/runner.ts`: backward-compatible optional `deviceId` option and registration propagation.
- `tests/worker/device-identity.test.ts`: persistence, reuse, file permissions, corrupt-state preservation, and startup lock cleanup.
- `tests/worker/runner.test.ts`: identical ID across Start → Exit → Start registrations even when the display name changes.

No server, shared-contract, UI, configuration, or archive-building files were changed in this bounded task. `Registration.deviceId` and its optional UUID schema were supplied separately by the parent recording implementation.

## Automated evidence

The identity tests were written first and initially failed because the loader and registration propagation did not exist. Final scoped verification:

```text
$ node_modules/node/bin/node node_modules/vitest/vitest.mjs run tests/worker/device-identity.test.ts tests/worker/runner.test.ts
Test Files  2 passed (2)
Tests       17 passed (17)
```

TypeScript verification:

```text
$ node_modules/node/bin/node node_modules/typescript/bin/tsc --noEmit
exit 0
```

The current shared client archive was inspected by filename; it contains neither `device-id.json` nor `worker.lock`. State files remain outside the source-only archive. Future archives must preserve that boundary: do not package a Worker's state directory and do not copy `device-id.json` between computers.

## Scope limits

This validation used temporary state directories and a child Worker process that fails before engine or network startup. It did not restart or control any live Worker, run a model, or start an experiment. The identity links registrations from one Worker installation; it does not claim to identify a physical device if the state directory is copied.
