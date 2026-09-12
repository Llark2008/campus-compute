import {expect, test} from "vitest";
import type {FaultInput, Heartbeat, LeaseRef} from "../../src/shared/contracts.ts";
import {buildServer} from "../../src/server/app.ts";
import {createCoordinatorClient} from "../../src/worker/client.ts";
import {fixture, testRegistration} from "../fixtures/core.ts";

test("real HTTP client faults, releases, and leaves through the SQLite coordinator protocol", async () => {
  const f = fixture();
  const app = buildServer({store: f.store, joinCode: "test-group"});
  const url = await app.listen({host: "127.0.0.1", port: 0});
  const client = createCoordinatorClient(url);
  const signal = new AbortController().signal;
  try {
    const session = await client.register(testRegistration, "test-group", signal);
    const heartbeat: Heartbeat = {state: "ready", level: "high", lease: null};
    await client.heartbeat(session, heartbeat, signal);

    const failedExperiment = f.store.create(f.input);
    const failedLease = await client.claim(session, signal);
    expect(failedLease).not.toBeNull();
    const failedRef: LeaseRef = {experimentId: failedLease!.experimentId, taskId: failedLease!.taskId, leaseId: failedLease!.leaseId, workerId: failedLease!.workerId};
    const fault: FaultInput = {...failedRef, code: "INPUT_TOO_LONG", message: "prompt plus output exceeds 2048 tokens"};
    await expect(client.fault(session, fault, signal)).resolves.toBeUndefined();
    expect(f.store.snapshot(failedExperiment.experimentId)).toMatchObject({failed: 1, queued: 0, leased: 0, state: "completed-with-errors"});

    const releasedExperiment = f.store.create(f.input);
    const releasedLease = await client.claim(session, signal);
    expect(releasedLease).not.toBeNull();
    const releasedRef: LeaseRef = {experimentId: releasedLease!.experimentId, taskId: releasedLease!.taskId, leaseId: releasedLease!.leaseId, workerId: releasedLease!.workerId};
    await expect(client.release(session, releasedRef, signal)).resolves.toBeUndefined();
    expect(f.store.snapshot(releasedExperiment.experimentId)).toMatchObject({failed: 0, queued: 1, leased: 0});

    const leaveLease = await client.claim(session, signal);
    expect(leaveLease?.taskId).toBe(releasedLease!.taskId);
    await expect(client.leave(session, signal)).resolves.toBeUndefined();
    expect(f.store.snapshot(releasedExperiment.experimentId)).toMatchObject({failed: 0, queued: 1, leased: 0});
    await expect(client.heartbeat(session, heartbeat, signal)).rejects.toMatchObject({code: "UNAUTHORIZED"});
  } finally {
    await app.close();
    f.store.close();
  }
});
