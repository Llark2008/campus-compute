import {cpus, totalmem, platform, arch} from "node:os";
import type {ControlCommand, FaultInput, Heartbeat, Lease, LeaseRef, LocalStatus, Receipt, Registration, RuntimeLock, SubmitInput, WorkerConfig, WorkerSession, WorkerState, Level} from "../shared/contracts.ts";
import {LIMITS} from "../shared/limits.ts";
import {DomainError} from "../shared/errors.ts";
import type {Engine} from "./engine.ts";
import {createCoordinatorClient, type CoordinatorClient} from "./client.ts";

export interface Runner {
  control(command: ControlCommand): Promise<LocalStatus>;
  status(): LocalStatus;
  close(): Promise<void>;
}

export function nextClaimAt(level: Level, acceptedAt: number, inferenceMs: number): number {
  const multiplier = {low: 2, medium: 1, high: 0}[level];
  return acceptedAt + multiplier * inferenceMs;
}

export async function waitAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DomainError("STOPPED", "等待取消");
  await new Promise<void>((resolve, reject) => {
    const done = () => { signal.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(done, Math.max(0, ms));
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DomainError("STOPPED", "等待取消")); };
    signal.addEventListener("abort", abort, {once: true});
  });
}

function leaseRef(lease: Lease): LeaseRef {
  return {experimentId: lease.experimentId, taskId: lease.taskId, leaseId: lease.leaseId, workerId: lease.workerId};
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function code(error: unknown): string | undefined { return error && typeof error === "object" && "code" in error ? String((error as {code?: unknown}).code) : undefined; }

export function createRunner(options: {engine: Engine; client: CoordinatorClient; config: WorkerConfig; runtime: RuntimeLock; deviceId?: string; now?: () => number}): Runner {
  const {engine, runtime} = options;
  const config = options.config;
  const now = options.now ?? (() => performance.now());
  let client = options.client;
  let desired: "running" | "paused" | "stopped" = "stopped";
  let state: WorkerState = "stopped";
  let level: Level = "medium";
  let session: WorkerSession | null = null;
  let currentLease: Lease | null = null;
  let pendingSubmit: Readonly<SubmitInput> | null = null;
  let completed = 0;
  let lastError: string | null = null;
  let lastConfirmedAt = 0;
  let lastInferenceMs = 0;
  let epoch = 0;
  let lifecycle: AbortController | null = null;
  let taskAbort: AbortController | null = null;
  let waitAbort: AbortController | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let heartbeatBusy = false;
  let heartbeatHealthy = true;
  let closed = false;
  let initializing: Promise<void> | null = null;
  let loop: Promise<void> | null = null;
  let abandoning: Promise<void> | null = null;
  let exiting: Promise<void> | null = null;
  const accepted = new Set<string>();

  const active = (value: number) => value === epoch && desired !== "stopped";
  const wake = () => { waitAbort?.abort(); waitAbort = null; };
  const setError = (error: unknown) => { lastError = message(error); state = "error"; };

  function snapshot(): LocalStatus {
    return {
      state, level, workerId: session?.workerId ?? null, taskId: currentLease?.taskId ?? null,
      enginePid: engine.pid(), coordinatorUrl: config.coordinatorUrl, name: config.name,
      backend: config.backend, completed, lastError,
    };
  }

  function acknowledge(receipt: Receipt) {
    if (!currentLease || receipt.taskId !== currentLease.taskId) return;
    if (!accepted.has(receipt.taskId)) { accepted.add(receipt.taskId); completed++; }
    lastConfirmedAt = now();
    lastInferenceMs = pendingSubmit?.output.inferenceMs ?? lastInferenceMs;
    currentLease = null;
    pendingSubmit = null;
    taskAbort?.abort(new DomainError("STOPPED", "结果已由协调服务确认"));
    taskAbort = null;
    if (desired === "paused") state = "paused";
    else if (desired === "running") state = level === "high" ? "ready" : "resting";
    wake();
  }

  async function restartEngine(localEpoch: number) {
    if (!active(localEpoch) || !lifecycle) return;
    state = "initializing";
    await engine.start(lifecycle.signal);
    if (active(localEpoch)) state = desired === "paused" ? "paused" : "ready";
  }

  async function abandonCurrent(localEpoch: number) {
    if (abandoning) return abandoning;
    abandoning = (async () => {
      taskAbort?.abort(new DomainError("LEASE_LOST", "租约已失效"));
      taskAbort = null;
      await engine.stop();
      currentLease = null;
      pendingSubmit = null;
      if (active(localEpoch)) {
        try { await restartEngine(localEpoch); }
        catch (error) { if (active(localEpoch)) setError(error); }
      }
      wake();
    })().finally(() => { abandoning = null; });
    return abandoning;
  }

  async function heartbeat(localEpoch: number): Promise<boolean> {
    if (heartbeatBusy || !active(localEpoch) || !session || !lifecycle) return false;
    heartbeatBusy = true;
    try {
      const input: Heartbeat = {state, level, lease: currentLease ? leaseRef(currentLease) : null};
      const sentLeaseId = input.lease?.leaseId ?? null;
      const reply = await client.heartbeat(session, input, lifecycle.signal);
      if (!active(localEpoch)) return true;
      heartbeatHealthy = true;
      if (reply.receipt) acknowledge(reply.receipt);
      else if (sentLeaseId && currentLease?.leaseId === sentLeaseId && !reply.leaseValid) await abandonCurrent(localEpoch);
    } catch (error) {
      if (active(localEpoch) && code(error) === "NETWORK") heartbeatHealthy = false;
      else if (active(localEpoch) && code(error) !== "STOPPED") {
        const failure = error;
        await exit();
        setError(failure);
      }
    } finally { heartbeatBusy = false; }
    return true;
  }

  function startHeartbeat(localEpoch: number) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => { void heartbeat(localEpoch); }, LIMITS.heartbeatMs);
  }

  async function waitFor(ms: number, localEpoch: number) {
    if (!lifecycle || !active(localEpoch)) return;
    const local = new AbortController(); waitAbort = local;
    try { await waitAbortable(ms, AbortSignal.any([lifecycle.signal, local.signal])); }
    catch (error) { if (code(error) !== "STOPPED") throw error; }
    finally { if (waitAbort === local) waitAbort = null; }
  }

  async function reportFault(lease: Lease, faultCode: FaultInput["code"], detail: string, localEpoch: number) {
    if (!session || !active(localEpoch) || !lifecycle) return;
    const fault: FaultInput = {...leaseRef(lease), code: faultCode, message: detail.slice(0, 2000)};
    try { await client.fault(session, fault, lifecycle.signal); }
    catch (error) { if (code(error) !== "NETWORK" && code(error) !== "LEASE_LOST" && code(error) !== "STOPPED") throw error; }
  }

  async function submitUntilKnown(localEpoch: number) {
    let retry = 0;
    while (active(localEpoch) && session && currentLease && pendingSubmit && lifecycle) {
      const original = pendingSubmit;
      try {
        const receipt = await client.submit(session, original, lifecycle.signal);
        acknowledge(receipt);
        return;
      } catch (error) {
        if (!active(localEpoch) || !currentLease || !pendingSubmit) return;
        if (code(error) === "LEASE_LOST") { await abandonCurrent(localEpoch); return; }
        if (code(error) !== "NETWORK") throw error;
        await waitFor([500, 1000, 2000][Math.min(retry++, 2)], localEpoch);
      }
    }
  }

  async function execute(lease: Lease, localEpoch: number) {
    if (!session || !lifecycle || !active(localEpoch)) return;
    if (lease.inferenceKey !== runtime.inferenceKey) {
      await reportFault(lease, "CONFIG_MISMATCH", "任务 inferenceKey 与本机运行清单不一致", localEpoch);
      currentLease = null;
      return;
    }
    state = desired === "paused" ? "pausing" : "computing";
    const controller = new AbortController(); taskAbort = controller;
    const timeout = AbortSignal.timeout(Math.max(1, lease.remainingAttemptMs));
    try {
      const output = await engine.infer(lease.messages, lease.generation, AbortSignal.any([lifecycle.signal, controller.signal, timeout]));
      if (!active(localEpoch) || controller.signal.aborted || currentLease?.leaseId !== lease.leaseId) return;
      state = desired === "paused" ? "pausing" : "uploading";
      pendingSubmit = Object.freeze({...leaseRef(lease), inferenceKey: runtime.inferenceKey, backend: config.backend, output: Object.freeze({...output})});
      await submitUntilKnown(localEpoch);
    } catch (error) {
      if (!active(localEpoch) || code(controller.signal.reason) === "LEASE_LOST") return;
      if (timeout.aborted) {
        await engine.stop();
        await reportFault(lease, "EXECUTION_TIMEOUT", "本地单题执行超时", localEpoch);
        currentLease = null; pendingSubmit = null;
        if (active(localEpoch)) await restartEngine(localEpoch);
      } else if (code(error) === "STOPPED" || (error instanceof Error && error.name === "AbortError" && lifecycle.signal.aborted)) {
        return;
      } else if (code(error) === "INPUT_TOO_LONG") {
        await reportFault(lease, "INPUT_TOO_LONG", message(error), localEpoch);
        currentLease = null; pendingSubmit = null;
      } else {
        await engine.stop();
        await reportFault(lease, "ENGINE_ERROR", message(error), localEpoch);
        currentLease = null; pendingSubmit = null;
        if (active(localEpoch)) await restartEngine(localEpoch);
      }
      if (desired === "paused") state = "paused";
    } finally { if (taskAbort === controller) taskAbort = null; }
  }

  async function workLoop(localEpoch: number) {
    let networkBackoff = 0;
    while (active(localEpoch) && lifecycle) {
      if (desired === "paused") { state = currentLease ? "pausing" : "paused"; await waitFor(86_400_000, localEpoch); continue; }
      if (currentLease || pendingSubmit) { await waitFor(50, localEpoch); continue; }
      const due = lastConfirmedAt ? nextClaimAt(level, lastConfirmedAt, lastInferenceMs) : now();
      if (due > now()) { state = "resting"; await waitFor(due - now(), localEpoch); continue; }
      if (!heartbeatHealthy) { state = "ready"; await waitFor([500, 1000, 2000][Math.min(networkBackoff++, 2)], localEpoch); continue; }
      state = "ready";
      try {
        if (!await heartbeat(localEpoch)) { await waitFor(50, localEpoch); continue; }
        if (!active(localEpoch) || !heartbeatHealthy || desired !== "running") continue;
        const lease = await client.claim(session!, lifecycle.signal);
        if (!active(localEpoch)) return;
        networkBackoff = 0;
        if (!lease) { await waitFor(LIMITS.idlePollMs, localEpoch); continue; }
        currentLease = lease;
        await execute(lease, localEpoch);
      } catch (error) {
        if (!active(localEpoch) || code(error) === "STOPPED") return;
        if (code(error) === "NETWORK") {
          heartbeatHealthy = false;
          await waitFor([500, 1000, 2000][Math.min(networkBackoff++, 2)], localEpoch);
        } else { setError(error); return; }
      }
    }
  }

  async function initialize(localEpoch: number) {
    try {
      await engine.start(lifecycle!.signal);
      if (!active(localEpoch)) return;
      await engine.infer([{role: "user", content: "local readiness check: reply OK"}], runtime.generation, lifecycle!.signal);
      if (!active(localEpoch)) return;
      const registration: Registration = {...(options.deviceId ? {deviceId: options.deviceId} : {}), name: config.name, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? "unknown", memoryBytes: totalmem(), backend: config.backend, inferenceKey: runtime.inferenceKey};
      session = await client.register(registration, config.joinCode, lifecycle!.signal);
      if (!active(localEpoch)) return;
      state = desired === "paused" ? "paused" : "ready";
      heartbeatHealthy = true;
      startHeartbeat(localEpoch);
      loop = workLoop(localEpoch).catch(error => { if (active(localEpoch)) setError(error); });
    } catch (error) {
      if (localEpoch !== epoch) return;
      await engine.stop().catch(() => {});
      if (desired !== "stopped") setError(error);
    } finally { if (localEpoch === epoch) initializing = null; }
  }

  function exit(): Promise<void> {
    if (exiting) return exiting;
    if (desired === "stopped" && state === "stopped") return Promise.resolve();
    exiting = (async () => {
      const oldInitializing = initializing;
      desired = "stopped"; state = "stopping"; epoch++;
      const oldSession = session;
      const oldLease = currentLease;
      lifecycle?.abort(new DomainError("STOPPED", "机主立即退出"));
      taskAbort?.abort(new DomainError("STOPPED", "机主立即退出"));
      wake();
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      let stopError: unknown = null;
      try { await engine.stop(); } catch (error) { stopError = error; }
      await oldInitializing?.catch(() => {});
      initializing = null; loop = null;
      if (!stopError && oldSession && oldLease) await client.release(oldSession, leaseRef(oldLease), AbortSignal.timeout(2500)).catch(() => {});
      if (!stopError && oldSession) await client.leave(oldSession, AbortSignal.timeout(2500)).catch(() => {});
      currentLease = null; pendingSubmit = null; session = null; lifecycle = null; taskAbort = null;
      if (stopError || engine.pid() !== null) setError(stopError ?? new Error("推理进程尚未退出"));
      else { state = "stopped"; lastError = null; }
    })().finally(() => { exiting = null; });
    return exiting;
  }

  return {
    async control(command) {
      if (closed && command.action !== "exit") throw new DomainError("STOPPED", "Worker 已关闭");
      if (command.action === "configure") {
        if ((state !== "stopped" && state !== "error") || engine.pid() !== null) throw new DomainError("VALIDATION", "只能在已停止且无引擎进程时修改连接");
        config.coordinatorUrl = command.coordinatorUrl; config.joinCode = command.joinCode; config.name = command.name;
        client = createCoordinatorClient(command.coordinatorUrl); lastError = null;
      } else if (command.action === "start") {
        if (desired === "paused" && session) {
          desired = "running"; state = "ready"; wake();
        } else if ((state === "stopped" || state === "error") && !initializing && engine.pid() === null) {
          desired = "running"; state = "initializing"; lastError = null; epoch++;
          lifecycle = new AbortController();
          const localEpoch = epoch;
          initializing = initialize(localEpoch);
        }
      } else if (command.action === "pause") {
        if (desired !== "stopped") { desired = "paused"; wake(); state = currentLease ? "pausing" : "paused"; }
      } else if (command.action === "set-level") {
        level = command.level; wake();
      } else if (command.action === "exit") await exit();
      return snapshot();
    },
    status: snapshot,
    async close() { if (!closed) { await exit(); closed = true; } },
  };
}
