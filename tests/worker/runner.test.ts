import {afterEach, expect, test} from "vitest";
import {createHarness, type Harness} from "../fixtures/worker.ts";
import {createRunner, nextClaimAt} from "../../src/worker/runner.ts";
import {totalmem} from "node:os";
import type {CoordinatorClient} from "../../src/worker/client.ts";
import type {Engine} from "../../src/worker/engine.ts";
import type {Registration, RuntimeLock, WorkerConfig} from "../../src/shared/contracts.ts";
import {GENERATION} from "../../src/shared/limits.ts";

const open: Harness[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(h => h.close())); });
const harness = () => { const h = createHarness(); open.push(h); return h; };

test("contribution levels use acknowledgment time and inference duration", () => {
  expect(nextClaimAt("low", 1000, 100)).toBe(1200);
  expect(nextClaimAt("medium", 1000, 100)).toBe(1100);
  expect(nextClaimAt("high", 1000, 100)).toBe(1000);
});

test("pause finishes the current task while heartbeat continues", async () => {
  const h = harness();
  await h.runner.control({action: "start"}); await h.advance(20);
  await h.runner.control({action: "pause"});
  await h.advance(3100);
  expect(h.calls.heartbeat).toBeGreaterThanOrEqual(1);
  h.completeInference(); await h.advance(20);
  expect(h.calls.submit).toBe(1);
  expect(h.calls.claim).toBe(1);
  expect(h.runner.status().state).toBe("paused");
});

test("exit stops the engine before releasing and never submits an aborted result", async () => {
  const h = harness();
  await h.runner.control({action: "start"}); await h.advance(20);
  await h.runner.control({action: "exit"});
  expect(h.calls.stop).toBe(1);
  expect(h.calls.release).toBe(1);
  expect(h.calls.leave).toBe(1);
  expect(h.calls.submit).toBe(0);
  expect(h.runner.status().state).toBe("stopped");
});

test("repeated start does not start a second lifecycle", async () => {
  const h = harness();
  await Promise.all([h.runner.control({action: "start"}), h.runner.control({action: "start"})]);
  await h.advance(20);
  expect(h.calls.infer).toBe(2); // one readiness check and one task
  expect(h.calls.claim).toBe(1);
});

test("registration reports installed memory capacity", async () => {
  const h = harness();
  await h.runner.control({action: "start"}); await h.advance(20);
  expect(h.calls.registrationMemory).toBe(totalmem());
});

test("every registration across exit and restart carries the same installation identity", async () => {
  const registrations: Registration[] = [];
  let started = false;
  const engine: Engine = {
    async start() { started = true; },
    async infer() { return {text: "OK", finishReason: "stop", inputTokens: 1, outputTokens: 1, inferenceMs: 1}; },
    async stop() { started = false; },
    pid() { return started ? 123 : null; },
    async describe() { return {engineVersion: "fixture", chatTemplate: "fixture", totalSlots: 1, contextSize: 2048}; },
  };
  const client: CoordinatorClient = {
    async register(input) { registrations.push(input); return {workerId: `w${registrations.length}`, token: "token"}; },
    async heartbeat() { return {leaseValid: true, remainingLeaseMs: 20_000, remainingAttemptMs: 120_000, receipt: null}; },
    async claim() { return null; }, async submit() { throw new Error("unexpected submit"); },
    async release() {}, async fault() {}, async leave() {},
  };
  const runtime: RuntimeLock = {
    adapterVersion: "llama-completion-v1", modelRepo: "fixture/model", modelRevision: "a".repeat(40), modelFile: "model.gguf",
    modelSha256: "b".repeat(64), engineVersion: "fixture", chatTemplateSha256: "c".repeat(64), generation: GENERATION,
    inferenceKey: "d".repeat(64), artifacts: [],
  };
  const config: WorkerConfig = {
    coordinatorUrl: "http://127.0.0.1:9999", joinCode: "join", name: "renameable display name", backend: "cpu",
    engineBin: "fixture", enginePrefix: [], modelPath: "fixture", enginePort: 4000, controlPort: 4317, stateDir: ".",
  };
  const deviceId = "995c346b-6b16-4a6b-a948-32c52e899cc6";
  const runner = createRunner({engine, client, config, runtime, deviceId});
  try {
    await runner.control({action: "start"}); await new Promise(resolve => setTimeout(resolve, 20));
    await runner.control({action: "exit"});
    config.name = "a different display name";
    await runner.control({action: "start"}); await new Promise(resolve => setTimeout(resolve, 20));
  } finally { await runner.close(); }

  expect(registrations).toHaveLength(2);
  expect(registrations.map(value => value.deviceId)).toEqual([deviceId, deviceId]);
});

test("exit during initialization permits a fresh start", async () => {
  const h = harness();
  await h.runner.control({action: "start"});
  await h.runner.control({action: "exit"});
  await h.runner.control({action: "start"}); await h.advance(20);
  expect(h.runner.status().state).toBe("computing");
});

test("a heartbeat receipt wins before a later invalid lease signal", async () => {
  const h = harness();
  await h.runner.control({action: "start"}); await h.advance(20);
  h.completeInference(); h.acceptOnHeartbeat();
  await h.advance(3100);
  expect(h.runner.status().completed).toBe(1);
  expect(h.calls.infer).toBe(2);
});

test("losing a lease aborts old inference and stops its engine", async () => {
  const h = harness();
  await h.runner.control({action: "start"}); await h.advance(20);
  h.loseLease(); await h.advance(3100);
  expect(h.calls.stop).toBeGreaterThanOrEqual(1);
  expect(h.calls.submit).toBe(0);
});

test("a heartbeat sent without a lease cannot invalidate a lease claimed while it was in flight", async () => {
  const h = createHarness({claimDelayMs: 3100, invalidHeartbeatDuringClaim: true}); open.push(h);
  await h.runner.control({action: "start"});
  await h.advance(3350);
  expect(h.runner.status().taskId).toBe("t1");
  expect(h.runner.status().state).toBe("computing");
  expect(h.calls.stop).toBe(0);
});

test("attempt timeout stops the owned engine before reporting a retryable fault", async () => {
  const h = createHarness({attemptMs: 20}); open.push(h);
  await h.runner.control({action: "start"}); await h.advance(80);
  expect(h.calls.stop).toBe(1);
  expect(h.calls.fault).toBe(1);
  expect(h.calls.faultCode).toBe("EXECUTION_TIMEOUT");
  expect(h.calls.submit).toBe(0);
});

test("pause while the ready heartbeat is in flight prevents the subsequent claim", async () => {
  const h = createHarness({initialHeartbeatDelayMs: 50}); open.push(h);
  await h.runner.control({action: "start"}); await h.advance(10);
  await h.runner.control({action: "pause"}); await h.advance(70);
  expect(h.calls.claim).toBe(0);
  expect(h.runner.status().state).toBe("paused");
});

test("an identity heartbeat failure stops computation and becomes a visible error", async () => {
  const h = createHarness({fatalHeartbeatAfter: 2}); open.push(h);
  await h.runner.control({action: "start"}); await h.advance(3100);
  expect(h.calls.stop).toBe(1);
  expect(h.runner.status().state).toBe("error");
  expect(h.runner.status().lastError).toMatch(/session expired/);
});

test("concurrent exit calls share one shutdown before restart", async () => {
  const h = createHarness({leaveDelayMs: 50}); open.push(h);
  await h.runner.control({action: "start"}); await h.advance(20);
  const first = h.runner.control({action: "exit"});
  const second = h.runner.control({action: "exit"});
  await Promise.all([first, second]);
  expect(h.calls.stop).toBe(1);
  expect(h.calls.leave).toBe(1);
  await h.runner.control({action: "start"}); await h.advance(20);
  expect(h.runner.status().state).toBe("computing");
});
