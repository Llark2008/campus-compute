import {afterEach, expect, test} from "vitest";
import {createServer} from "node:net";
import {mkdtemp, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, join, resolve} from "node:path";
import type {RuntimeLock} from "../../src/shared/contracts.ts";
import {GENERATION} from "../../src/shared/limits.ts";
import {backendVerified, computeInferenceKey, createEngine, hashFile, hashText, inferAt, type Engine} from "../../src/worker/engine.ts";
import {startFakeLlama, type FakeLlama} from "../fixtures/llama-server.ts";

let fake: FakeLlama | undefined;
let owned: Engine | undefined;
const dirs: string[] = [];
afterEach(async () => { if (fake) await fake.close(); fake = undefined; if (owned) await owned.stop(); owned = undefined; await Promise.all(dirs.splice(0).map(dir => rm(dir, {recursive: true, force: true}))); });

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("missing port"));
      const port = address.port;
      server.close(error => error ? reject(error) : resolvePort(port));
    });
  });
}

async function processConfig(delayed = false) {
  const dir = await mkdtemp(join(tmpdir(), "llama-engine-")); dirs.push(dir);
  const modelPath = join(dir, "model.gguf"); await writeFile(modelPath, "fixture-model");
  return {backend: "cpu" as const, engineBin: process.execPath, enginePrefix: ["--import", "tsx", resolve("tests/fixtures/llama-process.ts"), ...(delayed ? ["--fixture-delay"] : [])], modelPath, enginePort: await freePort(), stateDir: dir};
}

test("an over-budget prompt never reaches generation", async () => {
  fake = await startFakeLlama();
  fake.setTokenCount(1921);
  await expect(inferAt(fake.url, [{role: "user", content: "test"}], GENERATION, new AbortController().signal))
    .rejects.toMatchObject({code: "INPUT_TOO_LONG"});
  expect(fake.received.filter(x => x.path === "/completion")).toHaveLength(0);
});

test("a 1920-token prompt generates from the exact token array", async () => {
  fake = await startFakeLlama();
  fake.setTokenCount(1920);
  const output = await inferAt(fake.url, [{role: "user", content: "test"}], GENERATION, new AbortController().signal);
  const completion = fake.received.find(x => x.path === "/completion")?.body as {prompt: number[]; n_predict: number; samplers: string[]};
  expect(completion.prompt).toHaveLength(1920);
  expect(completion.prompt.slice(0, 3)).toEqual([10, 11, 12]);
  expect(completion).toMatchObject({n_predict: 128, samplers: ["temperature"]});
  expect(output.finishReason).toBe("stop");
});

test("llama limit stop maps to a retained length result", async () => {
  fake = await startFakeLlama();
  fake.setCompletion({stop_type: "limit", tokens_predicted: 128});
  await expect(inferAt(fake.url, [{role: "user", content: "test"}], GENERATION, new AbortController().signal))
    .resolves.toMatchObject({finishReason: "length", outputTokens: 128});
});

test("a context-truncated engine response is rejected", async () => {
  fake = await startFakeLlama();
  fake.setCompletion({truncated: true});
  await expect(inferAt(fake.url, [{role: "user", content: "test"}], GENERATION, new AbortController().signal))
    .rejects.toMatchObject({code: "ENGINE_ERROR"});
});

test("the adapter authenticates every engine request with its ephemeral key", async () => {
  fake = await startFakeLlama();
  fake.requireApiKey("engine-secret");
  await expect(inferAt(fake.url, [{role: "user", content: "test"}], GENERATION, new AbortController().signal))
    .rejects.toMatchObject({code: "ENGINE_ERROR"});
  await expect(inferAt(fake.url, [{role: "user", content: "test"}], GENERATION, new AbortController().signal, "engine-secret"))
    .resolves.toMatchObject({text: "ANSWER: B"});
});

test("the engine owns and terminates only the native process it starts", async () => {
  const config = await processConfig();
  owned = createEngine({config, expected: null});
  await owned.start(new AbortController().signal);
  const pid = owned.pid();
  expect(pid).toBeTypeOf("number");
  expect((await readdir(config.stateDir)).filter(name => name.startsWith("engine-api-"))).toHaveLength(1);
  await owned.stop();
  expect(owned.pid()).toBeNull();
  expect((await readdir(config.stateDir)).filter(name => name.startsWith("engine-api-"))).toHaveLength(0);
});

test("backend verification requires both device allocation and layer offload evidence", () => {
  expect(backendVerified("metal", ["ggml_metal: loaded Metal library"])).toBe(false);
  expect(backendVerified("metal", ["ggml_metal_init: picking device Apple M1 Pro", "load_tensors: offloaded 29/29 layers to GPU"])).toBe(true);
  expect(backendVerified("cuda", ["CUDA0 buffer allocation", "offloaded 29/29 layers to GPU"])).toBe(true);
});

test("inference key ignores artifact and self-referential lock fields", () => {
  const semantic = {adapterVersion: "llama-completion-v1" as const, modelRepo: "Qwen/model", modelRevision: "a".repeat(40), modelFile: "model.gguf", modelSha256: "b".repeat(64), engineVersion: "engine", chatTemplateSha256: "c".repeat(64), generation: GENERATION};
  const key = computeInferenceKey(semantic);
  expect(computeInferenceKey({...semantic, inferenceKey: "f".repeat(64), artifacts: [{platform: "darwin"}]} as typeof semantic)).toBe(key);
});

test("aborting model loading cancels start and confirms process exit", async () => {
  const config = await processConfig(true);
  owned = createEngine({config, expected: null});
  const controller = new AbortController();
  const starting = owned.start(controller.signal);
  setTimeout(() => controller.abort(), 50);
  await expect(starting).rejects.toMatchObject({code: "STOPPED"});
  expect(owned.pid()).toBeNull();
});

test("runtime lock verifies exact model and engine hashes before spawn", async () => {
  const config = await processConfig();
  const semantic = {adapterVersion: "llama-completion-v1" as const, modelRepo: "Qwen/model", modelRevision: "a".repeat(40), modelFile: basename(config.modelPath), modelSha256: await hashFile(config.modelPath), engineVersion: "fixture-engine", chatTemplateSha256: hashText("fixture-template"), generation: GENERATION};
  const expected: RuntimeLock = {...semantic, inferenceKey: computeInferenceKey(semantic), artifacts: [{platform: process.platform, arch: process.arch, backend: "cpu", binarySha256: await hashFile(config.engineBin), executable: basename(config.engineBin), prefix: [...config.enginePrefix]}]};
  await writeFile(config.modelPath, "tampered-model");
  owned = createEngine({config, expected});
  await expect(owned.start(new AbortController().signal)).rejects.toMatchObject({code: "CONFIG_MISMATCH"});
  expect(owned.pid()).toBeNull();
});

test("runtime hashing can be canceled before a process is spawned", async () => {
  const config = await processConfig();
  const controller = new AbortController(); controller.abort();
  await expect(hashFile(config.modelPath, controller.signal)).rejects.toMatchObject({code: "STOPPED"});
});
