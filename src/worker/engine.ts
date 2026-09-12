import {createHash, randomBytes} from "node:crypto";
import {createReadStream} from "node:fs";
import {mkdir, unlink, writeFile} from "node:fs/promises";
import {basename} from "node:path";
import {createServer} from "node:net";
import {execFile, spawn, type ChildProcess} from "node:child_process";
import {promisify} from "node:util";
import {z} from "zod";
import type {Generation, InferenceOutput, Message, RuntimeLock, WorkerConfig} from "../shared/contracts.ts";
import {DomainError} from "../shared/errors.ts";
import {hashJson} from "../domain/keys.ts";

export type EngineConfig = Pick<WorkerConfig, "backend" | "engineBin" | "enginePrefix" | "modelPath" | "enginePort" | "stateDir">;
export interface ProbeConfig extends EngineConfig {name: string; modelRepo: string; modelRevision: string}
export interface EngineDescription {engineVersion: string; chatTemplate: string; totalSlots: number; contextSize: number; backendEvidence?: string[]}
export interface Engine {
  start(signal: AbortSignal): Promise<void>;
  infer(messages: Message[], generation: Generation, signal: AbortSignal): Promise<InferenceOutput>;
  stop(): Promise<void>;
  pid(): number | null;
  describe(): Promise<EngineDescription>;
}

const execFileAsync = promisify(execFile);
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const delayAbortable = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(done, ms);
  function done() { signal.removeEventListener("abort", aborted); resolve(); }
  function aborted() { clearTimeout(timer); signal.removeEventListener("abort", aborted); reject(new DomainError("STOPPED", "引擎启动已取消")); }
  signal.addEventListener("abort", aborted, {once: true});
});
const completionSchema = z.object({
  content: z.string(), stop_type: z.enum(["eos", "word", "limit"]),
  tokens_evaluated: z.number().int().nonnegative(),
  tokens_predicted: z.number().int().nonnegative().max(128), truncated: z.boolean(),
}).passthrough();
const propsSchema = z.object({
  build_info: z.string().min(1), chat_template: z.string(), total_slots: z.number().int().positive(),
  default_generation_settings: z.object({n_ctx: z.number().int().positive()}).passthrough(),
}).passthrough();

function asEngineError(error: unknown, context: string): DomainError {
  if (error instanceof DomainError) return error;
  if (error instanceof z.ZodError) return new DomainError("ENGINE_ERROR", `${context}协议无效：${z.prettifyError(error)}`);
  return new DomainError("ENGINE_ERROR", error instanceof Error ? error.message : context);
}

async function request(base: string, path: string, init: RequestInit, signal: AbortSignal, apiKey?: string): Promise<unknown> {
  let response: Response;
  const headers = new Headers(init.headers);
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
  try { response = await fetch(new URL(path, base), {...init, headers, signal}); }
  catch (error) {
    if (signal.aborted) throw new DomainError("STOPPED", "引擎请求已取消");
    throw asEngineError(error, "引擎连接失败");
  }
  if (!response.ok) throw new DomainError("ENGINE_ERROR", `引擎返回 ${response.status}`);
  try { return await response.json(); }
  catch { throw new DomainError("ENGINE_ERROR", "引擎返回的不是 JSON"); }
}

async function post(base: string, path: string, body: unknown, signal: AbortSignal, apiKey?: string): Promise<unknown> {
  return request(base, path, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)}, signal, apiKey);
}

export async function inferAt(baseUrl: string, messages: Message[], generation: Generation, signal: AbortSignal, apiKey?: string): Promise<InferenceOutput> {
  try {
    const templated = z.object({prompt: z.string()}).passthrough().parse(await post(baseUrl, "/apply-template", {messages}, signal, apiKey));
    const {tokens} = z.object({tokens: z.array(z.number().int())}).passthrough().parse(await post(baseUrl, "/tokenize", {
      content: templated.prompt, add_special: false, parse_special: true, with_pieces: false,
    }, signal, apiKey));
    if (tokens.length + generation.maxTokens > generation.contextSize) {
      throw new DomainError("INPUT_TOO_LONG", "题目加输出预算超过上下文");
    }
    const started = performance.now();
    const raw = completionSchema.parse(await post(baseUrl, "/completion", {
      prompt: tokens, stream: false, n_predict: generation.maxTokens,
      temperature: 0, seed: generation.seed, cache_prompt: false,
      samplers: ["temperature"], id_slot: 0,
    }, signal, apiKey));
    const inferenceMs = performance.now() - started;
    if (raw.truncated) throw new DomainError("ENGINE_ERROR", "引擎意外截断上下文");
    if (raw.tokens_evaluated !== tokens.length) process.stderr.write(`引擎 token 计数不一致：预检 ${tokens.length}，生成 ${raw.tokens_evaluated}\n`);
    return {
      text: raw.content, finishReason: raw.stop_type === "limit" ? "length" : "stop",
      inputTokens: raw.tokens_evaluated, outputTokens: raw.tokens_predicted, inferenceMs,
    };
  } catch (error) { throw asEngineError(error, "引擎推理失败"); }
}

export async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DomainError("STOPPED", "文件哈希已取消");
  const hash = createHash("sha256");
  for await (const part of createReadStream(path)) {
    if (signal?.aborted) throw new DomainError("STOPPED", "文件哈希已取消");
    hash.update(part as Buffer);
  }
  return hash.digest("hex");
}

export function hashText(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function computeInferenceKey(input: Pick<RuntimeLock, "adapterVersion" | "modelRepo" | "modelRevision" | "modelFile" | "modelSha256" | "engineVersion" | "chatTemplateSha256" | "generation">): string {
  return hashJson({
    adapterVersion: input.adapterVersion,
    modelRepo: input.modelRepo,
    modelRevision: input.modelRevision,
    modelFile: input.modelFile,
    modelSha256: input.modelSha256,
    engineVersion: input.engineVersion,
    chatTemplateSha256: input.chatTemplateSha256,
    generation: input.generation,
  });
}

export function backendVerified(backend: EngineConfig["backend"], evidence: string[]): boolean {
  if (backend === "cpu") return true;
  const offloaded = evidence.some(line => /offload(?:ed|ing)?.*(?:gpu|layer)|(?:gpu|layer).*offload/i.test(line));
  const allocated = backend === "metal"
    ? evidence.some(line => /metal.*(?:device|buffer|alloc|picking)|(?:device|buffer|alloc|picking).*metal/i.test(line))
    : evidence.some(line => /cuda.*(?:device|buffer|alloc)|(?:device|buffer|alloc).*cuda/i.test(line));
  return offloaded && allocated;
}

async function ensurePortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => reject(new DomainError("ENGINE_ERROR", error.code === "EADDRINUSE" ? `引擎端口 ${port} 已被占用` : error.message)));
    server.listen({host: "127.0.0.1", port, exclusive: true}, () => server.close(error => error ? reject(error) : resolve()));
  });
}

function childExit(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    child.once("error", () => resolve());
    child.once("exit", () => resolve());
  });
}

export async function stopOwnedProcess(child: ChildProcess, exited: Promise<void>): Promise<void> {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    try { await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {windowsHide: true, timeout: 1500}); }
    catch (error) { if (child.exitCode === null && child.signalCode === null) throw error; }
  } else {
    try { process.kill(-pid, "SIGTERM"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    await Promise.race([exited, delay(800)]);
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-pid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
  }
  const ended = await Promise.race([exited.then(() => true, () => true), delay(1000).then(() => false)]);
  if (!ended) throw new Error("推理进程尚未确认退出");
}

async function validateFiles(config: EngineConfig, expected: RuntimeLock, signal: AbortSignal): Promise<void> {
  if (basename(config.modelPath) !== expected.modelFile) throw new DomainError("CONFIG_MISMATCH", "模型文件名与运行清单不一致");
  const artifact = expected.artifacts.find(item => item.platform === process.platform && item.arch === process.arch && item.backend === config.backend);
  if (!artifact) throw new DomainError("CONFIG_MISMATCH", "运行清单没有当前平台、架构与后端的构件");
  if (basename(config.engineBin) !== artifact.executable || stable(config.enginePrefix) !== stable(artifact.prefix)) throw new DomainError("CONFIG_MISMATCH", "引擎入口与运行清单不一致");
  const [modelHash, binaryHash] = await Promise.all([hashFile(config.modelPath, signal), hashFile(config.engineBin, signal)]);
  if (modelHash !== expected.modelSha256) throw new DomainError("CONFIG_MISMATCH", "模型 SHA-256 与运行清单不一致");
  if (binaryHash !== artifact.binarySha256) throw new DomainError("CONFIG_MISMATCH", "引擎 SHA-256 与运行清单不一致");
}

export function createEngine(options: {config: EngineConfig; expected: RuntimeLock | null}): Engine {
  const {config, expected} = options;
  const baseUrl = `http://127.0.0.1:${config.enginePort}`;
  let child: ChildProcess | null = null;
  let exited: Promise<void> | null = null;
  let starting: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;
  let startAbort: AbortController | null = null;
  const diagnostics: string[] = [];
  const backendEvidence: string[] = [];
  let apiKey: string | null = null;
  let apiKeyFile: string | null = null;
  const remember = (part: unknown) => {
    for (const source of String(part).split(/\r?\n/).filter(Boolean)) {
      const line = source.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
      diagnostics.push(line);
      if (/offload(?:ed|ing)?.*(?:gpu|layer)|(?:gpu|layer).*offload|metal.*(?:device|buffer|alloc|picking)|(?:device|buffer|alloc|picking).*metal|cuda.*(?:device|buffer|alloc)|(?:device|buffer|alloc).*cuda/i.test(line)) backendEvidence.push(line);
    }
    if (diagnostics.length > 200) diagnostics.splice(0, diagnostics.length - 200);
    if (backendEvidence.length > 80) backendEvidence.splice(0, backendEvidence.length - 80);
  };

  async function removeKey() {
    const path = apiKeyFile; apiKeyFile = null; apiKey = null;
    if (path) try { await unlink(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }

  async function describe(signal = new AbortController().signal): Promise<EngineDescription> {
    try {
      const props = propsSchema.parse(await request(baseUrl, "/props", {method: "GET"}, signal, apiKey ?? undefined));
      return {engineVersion: props.build_info, chatTemplate: props.chat_template, totalSlots: props.total_slots, contextSize: props.default_generation_settings.n_ctx,
        backendEvidence: [...backendEvidence]};
    } catch (error) { throw asEngineError(error, "读取引擎属性失败"); }
  }

  async function verifyRuntime(signal: AbortSignal) {
    const info = await describe(signal);
    if (info.totalSlots !== 1 || info.contextSize !== 2048) throw new DomainError("CONFIG_MISMATCH", "引擎必须使用单 slot 和 2048 上下文");
    if (expected) {
      if (info.engineVersion !== expected.engineVersion || hashText(info.chatTemplate) !== expected.chatTemplateSha256) throw new DomainError("CONFIG_MISMATCH", "引擎版本或聊天模板与运行清单不一致");
      if (computeInferenceKey(expected) !== expected.inferenceKey) throw new DomainError("CONFIG_MISMATCH", "运行清单 inferenceKey 无效");
      if (!backendVerified(config.backend, info.backendEvidence ?? [])) throw new DomainError("CONFIG_MISMATCH", `启动日志未确认 ${config.backend} 的设备分配与层卸载`);
    }
  }

  async function start(signal: AbortSignal): Promise<void> {
    if (stopping) await stopping;
    if (child && child.exitCode === null && child.signalCode === null) return starting ?? Promise.resolve();
    if (starting) return starting;
    if (child) { child = null; exited = null; await removeKey(); }
    const localAbort = new AbortController(); startAbort = localAbort;
    const onCallerAbort = () => localAbort.abort(signal.reason);
    signal.addEventListener("abort", onCallerAbort, {once: true});
    starting = (async () => {
      if (expected) await validateFiles(config, expected, localAbort.signal);
      if (localAbort.signal.aborted) throw new DomainError("STOPPED", "引擎启动已取消");
      await ensurePortFree(config.enginePort);
      await mkdir(config.stateDir, {recursive: true, mode: 0o700});
      apiKey = randomBytes(32).toString("base64url");
      apiKeyFile = `${config.stateDir}/engine-api-${randomBytes(12).toString("hex")}.key`;
      await writeFile(apiKeyFile, `${apiKey}\n`, {flag: "wx", mode: 0o600});
      const args = [...config.enginePrefix, "--model", config.modelPath, "--host", "127.0.0.1", "--port", String(config.enginePort), "--ctx-size", "2048", "--parallel", "1", "--n-gpu-layers", config.backend === "cpu" ? "0" : "99", "--no-context-shift", "--cache-ram", "0", "--no-cache-idle-slots", "--verbosity", "4", "--cors-origins", "localhost", "--no-webui", "--api-key-file", apiKeyFile];
      const spawned = spawn(config.engineBin, args, {shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
      child = spawned; exited = childExit(spawned);
      const spawnState: {failure: Error | null} = {failure: null};
      spawned.once("error", error => { spawnState.failure = error; });
      spawned.stdout?.on("data", remember); spawned.stderr?.on("data", remember);
      const deadline = performance.now() + 60_000;
      while (true) {
        if (localAbort.signal.aborted) throw new DomainError("STOPPED", "引擎启动已取消");
        if (spawnState.failure || spawned.exitCode !== null || spawned.signalCode !== null) throw new DomainError("ENGINE_ERROR", `引擎在就绪前退出：${spawnState.failure?.message ?? diagnostics.slice(-5).join(" | ")}`);
        try {
          const response = await fetch(new URL("/health", baseUrl), {headers: {authorization: `Bearer ${apiKey}`}, signal: AbortSignal.any([localAbort.signal, AbortSignal.timeout(500)])});
          if (response.ok) break;
        } catch (error) { if (localAbort.signal.aborted) throw new DomainError("STOPPED", "引擎启动已取消"); }
        if (performance.now() >= deadline) throw new DomainError("ENGINE_ERROR", "引擎启动超过 60 秒");
        await delayAbortable(100, localAbort.signal);
      }
      await verifyRuntime(localAbort.signal);
    })();
    try { await starting; }
    catch (error) {
      const owned = child, ownedExit = exited;
      if (stopping) {
        try { await stopping; }
        catch (stopError) { throw asEngineError(stopError, "引擎启动失败且进程未确认退出"); }
      } else if (owned && ownedExit) {
        try {
          await stopOwnedProcess(owned, ownedExit);
          if (child === owned) { child = null; exited = null; await removeKey(); }
        } catch (stopError) { throw asEngineError(stopError, "引擎启动失败且进程未确认退出"); }
      } else await removeKey().catch(() => {});
      throw asEngineError(error, "引擎启动失败");
    } finally {
      signal.removeEventListener("abort", onCallerAbort); starting = null; startAbort = null;
    }
  }

  async function stop(): Promise<void> {
    startAbort?.abort();
    if (stopping) return stopping;
    const owned = child, ownedExit = exited;
    if (!owned) {
      const pendingStart = starting;
      if (pendingStart) await pendingStart.catch(() => {});
      if (child) return stop();
      await removeKey();
      return;
    }
    stopping = (async () => {
      if (owned && ownedExit) await stopOwnedProcess(owned, ownedExit);
      if (child === owned) { child = null; exited = null; await removeKey(); }
    })();
    try { await stopping; } finally { stopping = null; }
  }

  return {
    start,
    async infer(messages, generation, signal) {
      if (!child || child.exitCode !== null || child.signalCode !== null) throw new DomainError("ENGINE_ERROR", "引擎尚未运行");
      return inferAt(baseUrl, messages, generation, signal, apiKey ?? undefined);
    },
    stop,
    pid() { return child && child.exitCode === null && child.signalCode === null ? child.pid ?? null : null; },
    describe: () => describe(),
  };
}
