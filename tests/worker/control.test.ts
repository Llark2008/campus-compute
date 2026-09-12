import {afterEach, expect, test} from "vitest";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {Runner} from "../../src/worker/runner.ts";
import type {ControlCommand, LocalStatus} from "../../src/shared/contracts.ts";
import {acquireInstanceLock, buildControlServer} from "../../src/worker/control.ts";

const apps: ReturnType<typeof buildControlServer>[] = [];
const dirs: string[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(dirs.splice(0).map(dir => rm(dir, {recursive: true, force: true}))); });

function fixture(webRoot = "/does/not/exist") {
  let calls = 0;
  const status: LocalStatus = {state: "stopped", level: "medium", workerId: null, taskId: null, enginePid: null, coordinatorUrl: "http://coordinator.test", name: "fixture", backend: "cpu", completed: 0, lastError: null};
  const runner: Runner = {status: () => status, async control(_command: ControlCommand) { calls++; return status; }, async close() {}};
  const app = buildControlServer({runner, port: 4317, token: "fixture-local-token", webRoot}); apps.push(app);
  return {app, calls: () => calls};
}

test.each([
  ["missing token", {host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317"}],
  ["wrong token", {host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317", authorization: "Bearer wrong"}],
  ["external origin", {host: "127.0.0.1:4317", origin: "https://unrelated.example", authorization: "Bearer fixture-local-token"}],
  ["forged host", {host: "evil.example", origin: "http://evil.example", authorization: "Bearer fixture-local-token"}],
])("%s cannot control the worker", async (_name, headers) => {
  const {app, calls} = fixture();
  const response = await app.inject({method: "POST", url: "/api/local/control", headers, payload: {action: "exit"}});
  expect(response.statusCode).toBe(403);
  expect(calls()).toBe(0);
});

test("a same-origin authenticated request controls exactly once", async () => {
  const {app, calls} = fixture();
  const response = await app.inject({method: "POST", url: "/api/local/control", headers: {host: "localhost:4317", origin: "http://localhost:4317", authorization: "Bearer fixture-local-token"}, payload: {action: "pause"}});
  expect(response.statusCode).toBe(200);
  expect(calls()).toBe(1);
});

test("bootstrap accepts only an allowed loopback Host and does not expose config secrets", async () => {
  const {app} = fixture();
  const bad = await app.inject({method: "GET", url: "/api/bootstrap", headers: {host: "evil.example"}});
  expect(bad.statusCode).toBe(403);
  const good = await app.inject({method: "GET", url: "/api/bootstrap", headers: {host: "127.0.0.1:4317"}});
  expect(good.json()).toEqual({surface: "worker", token: "fixture-local-token"});
  expect(JSON.stringify(good.json())).not.toContain("join");
});

test("a built contributor page is served from the real static root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worker-web-")); dirs.push(dir);
  await writeFile(join(dir, "index.html"), "<!doctype html><title>Contributor</title>");
  const {app} = fixture(dir);
  const response = await app.inject({method: "GET", url: "/", headers: {host: "127.0.0.1:4317"}});
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain("Contributor");
});

test("a live worker instance lock rejects a second owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worker-lock-")); dirs.push(dir);
  const first = await acquireInstanceLock(dir);
  await expect(acquireInstanceLock(dir)).rejects.toMatchObject({code: "VALIDATION"});
  await first.release();
});

test("a stale lock is replaced and release removes only its own lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worker-lock-")); dirs.push(dir);
  const path = join(dir, "worker.lock");
  await writeFile(path, JSON.stringify({pid: 999_999_999, instanceId: "stale"}));
  const lock = await acquireInstanceLock(dir);
  expect(JSON.parse(await readFile(path, "utf8")).instanceId).toBe(lock.instanceId);
  await lock.release();
  await expect(readFile(path, "utf8")).rejects.toMatchObject({code: "ENOENT"});
});

test("an empty in-progress lock is treated as a live owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worker-lock-")); dirs.push(dir);
  const path = join(dir, "worker.lock");
  await writeFile(path, "");
  await expect(acquireInstanceLock(dir)).rejects.toMatchObject({code: "VALIDATION"});
  expect(await readFile(path, "utf8")).toBe("");
});


test("a running contributor serves new hashed assets after a web rebuild", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worker-web-rebuild-")); dirs.push(dir);
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "index.html"), '<script src="/assets/old.js"></script>');
  await writeFile(join(dir, "assets/old.js"), "old build");
  const {app} = fixture(dir), headers = {host: "127.0.0.1:4317"};
  expect((await app.inject({url: "/assets/old.js", headers})).statusCode).toBe(200);

  await rm(join(dir, "assets/old.js"));
  await writeFile(join(dir, "assets/new.js"), "new build");
  await writeFile(join(dir, "assets/new.css"), "body { color: black; }");
  await writeFile(join(dir, "index.html"), '<script src="/assets/new.js"></script><link rel="stylesheet" href="/assets/new.css">');
  const page = await app.inject({url: "/", headers});
  expect(page.statusCode).toBe(200);
  expect(page.body).toContain("/assets/new.js");
  for (const [asset, contentType] of [["new.js", "javascript"], ["new.css", "text/css"]]) {
    const response = await app.inject({url: `/assets/${asset}`, headers});
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(contentType);
  }
  expect((await app.inject({url: "/assets/old.js", headers})).statusCode).toBe(404);
  expect((await app.inject({url: "/assets/new.js", headers: {host: "evil.example"}})).statusCode).toBe(403);
  expect((await app.inject({url: "/api/local/status", headers})).statusCode).toBe(403);
});
