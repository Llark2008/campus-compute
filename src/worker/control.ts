import {randomBytes} from "node:crypto";
import {constants, existsSync} from "node:fs";
import {mkdir, open, readFile, stat, unlink} from "node:fs/promises";
import {join, resolve} from "node:path";
import Fastify, {type FastifyInstance} from "fastify";
import fastifyStatic from "@fastify/static";
import {z} from "zod";
import {ControlSchema} from "../shared/schemas.ts";
import {DomainError} from "../shared/errors.ts";
import type {Runner} from "./runner.ts";

export interface InstanceLock {path: string; instanceId: string; release(): Promise<void>}

function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export async function acquireInstanceLock(stateDir: string): Promise<InstanceLock> {
  await mkdir(stateDir, {recursive: true, mode: 0o700});
  const path = join(stateDir, "worker.lock");
  const instanceId = randomBytes(16).toString("hex");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      try { await handle.writeFile(JSON.stringify({pid: process.pid, instanceId})); }
      finally { await handle.close(); }
      return {
        path, instanceId,
        async release() {
          try {
            const value = JSON.parse(await readFile(path, "utf8")) as {instanceId?: unknown};
            if (value.instanceId === instanceId) await unlink(path);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let before;
      try { before = await stat(path); } catch { continue; }
      let existing: {pid?: unknown; instanceId?: unknown};
      try { existing = JSON.parse(await readFile(path, "utf8")) as {pid?: unknown; instanceId?: unknown}; }
      catch { throw new DomainError("VALIDATION", "Worker 单实例锁正在建立或内容不可读"); }
      if (!Number.isSafeInteger(existing.pid) || typeof existing.instanceId !== "string" || !existing.instanceId) throw new DomainError("VALIDATION", "Worker 单实例锁正在建立或内容无效");
      if (processAlive(existing.pid as number)) throw new DomainError("VALIDATION", `Worker 已在运行（PID ${existing.pid}）`);
      try {
        const after = await stat(path);
        if (before.dev === after.dev && before.ino === after.ino) await unlink(path);
      } catch (staleError) { if ((staleError as NodeJS.ErrnoException).code !== "ENOENT") throw staleError; }
    }
  }
  throw new DomainError("VALIDATION", "无法安全取得 Worker 单实例锁");
}

function bearer(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

export function buildControlServer(options: {runner: Runner; port: number; token: string; webRoot: string}): FastifyInstance {
  const {runner, port, token, webRoot} = options;
  const app = Fastify({logger: false});
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  app.addHook("onRequest", async (request, reply) => {
    if (!allowedHosts.has(request.headers.host ?? "")) return reply.code(403).send({error: {code: "UNAUTHORIZED", message: "本机地址不匹配"}});
  });
  app.get("/api/bootstrap", async () => ({surface: "worker" as const, token}));
  app.get("/api/local/status", async (request, reply) => {
    if (bearer(request.headers.authorization) !== token) return reply.code(403).send({error: {code: "UNAUTHORIZED", message: "本机控制身份不匹配"}});
    return runner.status();
  });
  app.post("/api/local/control", async (request, reply) => {
    const origin = `http://${request.headers.host}`;
    if (request.headers.origin !== origin || bearer(request.headers.authorization) !== token) {
      return reply.code(403).send({error: {code: "UNAUTHORIZED", message: "本机控制身份不匹配"}});
    }
    const parsed = ControlSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({error: {code: "VALIDATION", message: z.prettifyError(parsed.error)}});
    return runner.control(parsed.data);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.code(error.code === "UNAUTHORIZED" ? 403 : 400).send({error: {code: error.code, message: error.message}});
    return reply.code(500).send({error: {code: "ENGINE_ERROR", message: error instanceof Error ? error.message : "本机控制服务错误"}});
  });
  const root = resolve(webRoot);
  if (existsSync(root)) {
    // Resolve assets at request time: web rebuilds replace their hashed filenames.
    app.register(fastifyStatic, {root, wildcard: true});
  } else {
    app.get("/", async (_request, reply) => reply.type("text/html").send("<!doctype html><title>Campus Compute Worker</title><main>Worker control UI is not built.</main>"));
  }
  return app;
}
