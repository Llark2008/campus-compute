import {arch, cpus, freemem, platform, release, totalmem} from "node:os";
import {basename, dirname, resolve} from "node:path";
import {readFile, mkdir, rename, writeFile} from "node:fs/promises";
import {parseArgs} from "node:util";
import {z} from "zod";
import type {RuntimeLock} from "../src/shared/contracts.ts";
import {BackendSchema, RuntimeLockSchema} from "../src/shared/schemas.ts";
import {GENERATION, LIMITS} from "../src/shared/limits.ts";
import {parseJsonl} from "../src/domain/dataset.ts";
import {renderMessages} from "../src/domain/prompts.ts";
import {backendVerified, computeInferenceKey, createEngine, hashFile, hashText, type ProbeConfig} from "../src/worker/engine.ts";

const probeConfigSchema = z.object({
  name: z.string().trim().min(1).max(100), modelRepo: z.string().min(1), modelRevision: z.string().regex(/^[a-f0-9]{40}$/),
  backend: BackendSchema, engineBin: z.string().min(1), enginePrefix: z.array(z.string()), modelPath: z.string().min(1),
  enginePort: z.number().int().min(1024).max(65535), stateDir: z.string().min(1),
}).strict();

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), {recursive: true});
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
  await rename(temporary, path);
}

async function existingLock(path: string): Promise<RuntimeLock | null> {
  try {
    const value = RuntimeLockSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!value.success) throw new Error(`现有运行清单无效：${z.prettifyError(value.error)}`);
    return value.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function mergeCompatibleLock(current: RuntimeLock | null, candidate: RuntimeLock): RuntimeLock {
  if (!current) return candidate;
  if (current.inferenceKey !== candidate.inferenceKey || computeInferenceKey(current) !== candidate.inferenceKey) {
    throw new Error("现有运行清单的语义指纹与本次探针不一致，拒绝覆盖");
  }
  const addition = candidate.artifacts[0]!;
  const match = current.artifacts.find(item => item.platform === addition.platform && item.arch === addition.arch && item.backend === addition.backend);
  if (match && JSON.stringify(match) !== JSON.stringify(addition)) throw new Error("当前平台已有不同的引擎构件清单，拒绝覆盖");
  return match ? current : {...current, artifacts: [...current.artifacts, addition]};
}

async function main() {
  const {values} = parseArgs({options: {config: {type: "string"}, lock: {type: "string"}, output: {type: "string"}}, strict: true});
  if (!values.config || !values.lock || !values.output) throw new Error("Usage: probe --config config/local-probe.json --lock config/runtime.lock.json --output docs/validation/probe-device.json");
  const configPath = resolve(values.config), lockPath = resolve(values.lock), outputPath = resolve(values.output);
  const parsed = probeConfigSchema.safeParse(JSON.parse(await readFile(configPath, "utf8")));
  if (!parsed.success) throw new Error(`探针配置无效：${z.prettifyError(parsed.error)}`);
  const config: ProbeConfig = parsed.data;
  const startedAt = new Date().toISOString();
  const hashingStarted = performance.now();
  const [modelSha256, binarySha256] = await Promise.all([hashFile(config.modelPath), hashFile(config.engineBin)]);
  const hashingMs = performance.now() - hashingStarted;
  const engine = createEngine({config, expected: null});
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  const results: {sampleId: string; text: string; finishReason: string; inputTokens: number; outputTokens: number; inferenceMs: number}[] = [];
  let coldStartMs = 0;
  try {
    const coldStarted = performance.now();
    await engine.start(abort.signal);
    coldStartMs = performance.now() - coldStarted;
    const description = await engine.describe();
    if (description.totalSlots !== 1 || description.contextSize !== 2048) throw new Error("探针只接受单 slot、2048 上下文的引擎");
    if (!backendVerified(config.backend, description.backendEvidence ?? [])) throw new Error(`启动日志没有确认 ${config.backend} 的设备分配与层卸载`);
    await engine.infer([{role: "user", content: "Reply with exactly: OK"}], GENERATION, AbortSignal.any([abort.signal, AbortSignal.timeout(LIMITS.attemptMs)]));
    const rows = parseJsonl(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../data/arc-demo.jsonl"), "utf8")).slice(0, 20);
    if (rows.length !== 20) throw new Error("ARC 探针需要固定 20 题");
    const variant = {id: "probe", name: "probe", instruction: "Answer the science multiple-choice question. Return exactly one line: ANSWER: X, where X is the chosen option label.", examples: [], responseMode: "answer-only" as const};
    for (const sample of rows) {
      const output = await engine.infer(renderMessages(sample, variant), GENERATION, AbortSignal.any([abort.signal, AbortSignal.timeout(LIMITS.attemptMs)]));
      results.push({sampleId: sample.id, ...output});
    }
    const semantic = {
      adapterVersion: "llama-completion-v1" as const, modelRepo: config.modelRepo, modelRevision: config.modelRevision,
      modelFile: basename(config.modelPath), modelSha256, engineVersion: description.engineVersion,
      chatTemplateSha256: hashText(description.chatTemplate), generation: GENERATION,
    };
    const candidate: RuntimeLock = {
      ...semantic, inferenceKey: computeInferenceKey(semantic),
      artifacts: [{platform: platform(), arch: arch(), backend: config.backend, binarySha256, executable: basename(config.engineBin), prefix: [...config.enginePrefix]}],
    };
    const runtime = mergeCompatibleLock(await existingLock(lockPath), candidate);
    await atomicJson(lockPath, runtime);
    await atomicJson(outputPath, {
      status: "passed", device: config.name, startedAt, finishedAt: new Date().toISOString(),
      system: {platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model ?? "unknown", logicalCpus: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytesAtEnd: freemem()},
      runtime, paths: {modelFile: basename(config.modelPath), engineExecutable: basename(config.engineBin)},
      measurements: {hashingMs, coldStartMs, backendEvidence: description.backendEvidence ?? []}, results,
    });
  } finally {
    process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
    abort.abort(); await engine.stop();
  }
}

import {fileURLToPath} from "node:url";
main().catch(error => { process.exitCode = 1; process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); });
