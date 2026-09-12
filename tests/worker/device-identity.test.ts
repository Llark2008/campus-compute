import {execFile, spawn} from "node:child_process";
import {constants} from "node:fs";
import {access, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {promisify} from "node:util";
import {afterEach, expect, test} from "vitest";
import {loadOrCreateDeviceId} from "../../src/worker/device-identity.ts";

const dirs: string[] = [];
const execFileAsync = promisify(execFile);
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, {recursive: true, force: true}))); });

async function stateDir() {
  const dir = await mkdtemp(join(tmpdir(), "worker-identity-"));
  dirs.push(dir);
  return dir;
}

test("creates one opaque UUID in a private state file and reuses it", async () => {
  const dir = await stateDir();
  const loadInFreshProcess = async () => (await execFileAsync(
    resolve("node_modules/node/bin/node"),
    ["--import", "tsx", "--input-type=module", "--eval", "import {loadOrCreateDeviceId} from './src/worker/device-identity.ts'; process.stdout.write(await loadOrCreateDeviceId(process.argv[1]));", dir],
    {cwd: resolve(".")},
  )).stdout;
  const first = await loadInFreshProcess();
  const second = await loadInFreshProcess();
  const path = join(dir, "device-id.json");

  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(second).toBe(first);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({deviceId: first});
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test("rejects a malformed stored identity without replacing it", async () => {
  const dir = await stateDir();
  const path = join(dir, "device-id.json");
  const malformed = JSON.stringify({deviceId: "hardware-derived-name"});
  await writeFile(path, malformed, {mode: 0o600});

  await expect(loadOrCreateDeviceId(dir)).rejects.toThrow(/device-id\.json.*invalid/i);
  expect(await readFile(path, "utf8")).toBe(malformed);
});

test("worker startup releases its newly acquired lock when identity loading fails", async () => {
  const dir = await stateDir();
  await writeFile(join(dir, "device-id.json"), "not-json", {mode: 0o600});
  const configPath = join(dir, "worker.json");
  await writeFile(configPath, JSON.stringify({
    coordinatorUrl: "http://127.0.0.1:65534", joinCode: "join", name: "fixture", backend: "cpu",
    engineBin: process.execPath, enginePrefix: [], modelPath: join(dir, "model.gguf"),
    enginePort: 45431, controlPort: 45432, stateDir: dir,
  }));

  const result = await new Promise<{code: number | null; stderr: string}>((done, reject) => {
    const child = spawn(resolve("node_modules/node/bin/node"), ["--import", "tsx", "src/worker/main.ts", "--config", configPath], {
      cwd: resolve("."), stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    const timeout = setTimeout(() => child.kill("SIGTERM"), 5000);
    child.once("close", code => { clearTimeout(timeout); done({code, stderr}); });
  });

  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/device-id\.json.*invalid/i);
  await expect(access(join(dir, "worker.lock"), constants.F_OK)).rejects.toMatchObject({code: "ENOENT"});
});
