import type {Engine} from "../../src/worker/engine.ts";
import type {CoordinatorClient} from "../../src/worker/client.ts";
import type {HeartbeatReply, InferenceOutput, Lease, Receipt, RuntimeLock, WorkerConfig, WorkerSession, WorkerState} from "../../src/shared/contracts.ts";
import {GENERATION} from "../../src/shared/limits.ts";
import {createRunner, type Runner} from "../../src/worker/runner.ts";
import {DomainError} from "../../src/shared/errors.ts";

export interface Harness {
  runner: Runner;
  calls: {claim: number; submit: number; heartbeat: number; stop: number; infer: number; release: number; leave: number; fault: number; faultCode: string | null; registrationMemory: number};
  completeInference(output?: InferenceOutput): void;
  loseLease(): void;
  acceptOnHeartbeat(): void;
  advance(ms: number): Promise<void>;
  close(): Promise<void>;
}

const lock: RuntimeLock = {
  adapterVersion: "llama-completion-v1", modelRepo: "Qwen/model", modelRevision: "a".repeat(40), modelFile: "model.gguf",
  modelSha256: "b".repeat(64), engineVersion: "fixture", chatTemplateSha256: "c".repeat(64), generation: GENERATION,
  inferenceKey: "d".repeat(64), artifacts: [{platform: process.platform, arch: process.arch, backend: "cpu", binarySha256: "e".repeat(64), executable: "fixture", prefix: []}],
};
const config: WorkerConfig = {coordinatorUrl: "http://127.0.0.1:9999", joinCode: "join", name: "fixture", backend: "cpu", engineBin: "fixture", enginePrefix: [], modelPath: "fixture", enginePort: 4000, controlPort: 4317, stateDir: "."};
const lease: Lease = {experimentId: "e1", taskId: "t1", leaseId: "l1", workerId: "w1", inferenceKey: lock.inferenceKey, messages: [{role: "user", content: "question"}], generation: GENERATION, remainingLeaseMs: 20_000, remainingAttemptMs: 120_000};
const receipt: Receipt = {taskId: "t1", resultId: "r1", acceptedAt: 1000, credit: 1};

export function createHarness(options: {claimDelayMs?: number; invalidHeartbeatDuringClaim?: boolean; attemptMs?: number; initialHeartbeatDelayMs?: number; fatalHeartbeatAfter?: number; leaveDelayMs?: number} = {}): Harness {
  const calls = {claim: 0, submit: 0, heartbeat: 0, stop: 0, infer: 0, release: 0, leave: 0, fault: 0, faultCode: null as string | null, registrationMemory: 0};
  let resolveInference: ((output: InferenceOutput) => void) | undefined;
  let started = false;
  let lose = false;
  let heartbeatReceipt = false;
  let claimIssued = false;
  let serverState: WorkerState = "offline";
  let claimInFlight = false;
  const session: WorkerSession = {workerId: "w1", token: "token"};
  const engine: Engine = {
    async start() { started = true; },
    async infer(messages, _generation, signal) {
      calls.infer++;
      if (messages[0]?.content.includes("local readiness check")) return {text: "OK", finishReason: "stop", inputTokens: 2, outputTokens: 1, inferenceMs: 1};
      return new Promise((resolve, reject) => {
        resolveInference = resolve;
        signal.addEventListener("abort", () => reject(new DomainError("STOPPED", "engine request canceled")), {once: true});
      });
    },
    async stop() { calls.stop++; started = false; }, pid() { return started ? 123 : null; },
    async describe() { return {engineVersion: "fixture", chatTemplate: "fixture", totalSlots: 1, contextSize: 2048}; },
  };
  const client: CoordinatorClient = {
    async register(input) { calls.registrationMemory = input.memoryBytes; serverState = "initializing"; return session; },
    async heartbeat(_session, input) {
      calls.heartbeat++;
      serverState = input.state;
      if (calls.heartbeat === 1 && options.initialHeartbeatDelayMs) await new Promise(resolve => setTimeout(resolve, options.initialHeartbeatDelayMs));
      if (options.fatalHeartbeatAfter && calls.heartbeat >= options.fatalHeartbeatAfter) throw new DomainError("UNAUTHORIZED", "session expired");
      if (options.invalidHeartbeatDuringClaim && claimInFlight && calls.heartbeat > 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
        return {leaseValid: false, remainingLeaseMs: 0, remainingAttemptMs: 0, receipt: null};
      }
      const value: HeartbeatReply = heartbeatReceipt
        ? {leaseValid: true, remainingLeaseMs: 20_000, remainingAttemptMs: 100_000, receipt}
        : {leaseValid: !lose, remainingLeaseMs: lose ? 0 : 20_000, remainingAttemptMs: lose ? 0 : 100_000, receipt: null};
      heartbeatReceipt = false;
      return value;
    },
    async claim() {
      calls.claim++;
      if (serverState !== "ready" || claimIssued) return null;
      claimIssued = true; claimInFlight = true;
      if (options.claimDelayMs) await new Promise(resolve => setTimeout(resolve, options.claimDelayMs));
      claimInFlight = false;
      return {...lease, remainingAttemptMs: options.attemptMs ?? lease.remainingAttemptMs};
    },
    async submit() { calls.submit++; if (heartbeatReceipt) throw Object.assign(new Error("lost response"), {code: "NETWORK"}); return receipt; },
    async release() { calls.release++; claimIssued = false; }, async fault(_session, input) { calls.fault++; calls.faultCode = input.code; }, async leave() { calls.leave++; if (options.leaveDelayMs) await new Promise(resolve => setTimeout(resolve, options.leaveDelayMs)); },
  };
  const runner = createRunner({engine, client, config: {...config}, runtime: lock});
  return {
    runner, calls,
    completeInference(output = {text: "ANSWER: B", finishReason: "stop", inputTokens: 20, outputTokens: 4, inferenceMs: 100}) { resolveInference?.(output); },
    loseLease() { lose = true; },
    acceptOnHeartbeat() { heartbeatReceipt = true; },
    async advance(ms) { await new Promise(resolve => setTimeout(resolve, ms)); await Promise.resolve(); },
    async close() { await runner.close(); },
  };
}
