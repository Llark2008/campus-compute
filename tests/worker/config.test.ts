import {afterEach, expect, test} from "vitest";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {readWorkerConfig} from "../../src/worker/config.ts";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, {recursive: true, force: true}))); });

async function config(overrides: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "worker-config-")); dirs.push(dir);
  const path = join(dir, "worker.json");
  await writeFile(path, JSON.stringify({coordinatorUrl: "http://127.0.0.1:8080", joinCode: "join", name: "device", backend: "cpu", engineBin: "/engine", enginePrefix: [], modelPath: "/model.gguf", enginePort: 8081, controlPort: 4317, stateDir: dir, ...overrides}));
  return path;
}

test("worker config accepts explicit native paths and ports", async () => {
  const path = await config();
  expect(readWorkerConfig(path)).toMatchObject({backend: "cpu", enginePort: 8081, controlPort: 4317});
});

test("worker config rejects credentials in coordinator URL", async () => {
  const path = await config({coordinatorUrl: "http://secret@example.test"});
  expect(() => readWorkerConfig(path)).toThrow(/配置无效/);
});

test("worker config rejects sharing one port between engine and control", async () => {
  const path = await config({controlPort: 8081});
  expect(() => readWorkerConfig(path)).toThrow(/配置无效/);
});
