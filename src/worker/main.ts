import {randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {z} from "zod";
import {RuntimeLockSchema} from "../shared/schemas.ts";
import {readWorkerConfig} from "./config.ts";
import {createEngine} from "./engine.ts";
import {createCoordinatorClient} from "./client.ts";
import {createRunner} from "./runner.ts";
import {acquireInstanceLock, buildControlServer} from "./control.ts";
import {loadOrCreateDeviceId} from "./device-identity.ts";

async function readRuntimeLock(path: string) {
  const parsed = RuntimeLockSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) throw new Error(`运行清单无效：${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

async function main() {
  const {values} = parseArgs({options: {config: {type: "string"}}, strict: true});
  if (!values.config) throw new Error("Usage: worker --config /absolute/path/to/worker-config.json");
  const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const config = readWorkerConfig(resolve(values.config));
  const runtime = await readRuntimeLock(resolve(projectDir, "config/runtime.lock.json"));
  const lock = await acquireInstanceLock(config.stateDir);
  let runner: ReturnType<typeof createRunner> | undefined;
  let app: ReturnType<typeof buildControlServer> | undefined;
  try {
    const deviceId = await loadOrCreateDeviceId(config.stateDir);
    const engine = createEngine({config, expected: runtime});
    const client = createCoordinatorClient(config.coordinatorUrl);
    runner = createRunner({engine, client, config, runtime, deviceId});
    app = buildControlServer({runner, port: config.controlPort, token: randomBytes(32).toString("base64url"), webRoot: resolve(projectDir, "dist/web")});
  } catch (error) {
    await runner?.close().catch(() => {});
    await app?.close().catch(() => {});
    await lock.release().catch(() => {});
    throw error;
  }
  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await runner.close(); await app.close(); await lock.release(); }
    catch (error) { process.exitCode = 1; process.stderr.write(`Worker 清理失败 (${reason})：${error instanceof Error ? error.message : String(error)}\n`); }
  };
  process.once("SIGINT", () => { void shutdown("SIGINT"); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  try {
    await app.listen({host: "127.0.0.1", port: config.controlPort});
    process.stdout.write(`Campus Compute Worker control: http://127.0.0.1:${config.controlPort}\n`);
  } catch (error) {
    await runner.close().catch(() => {});
    await app.close().catch(() => {});
    await lock.release().catch(() => {});
    throw error;
  }
}

main().catch(error => { process.exitCode = 1; process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); });
