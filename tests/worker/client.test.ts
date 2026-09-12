import Fastify, {type FastifyInstance} from "fastify";
import {afterEach, expect, test} from "vitest";
import type {SubmitInput, WorkerSession} from "../../src/shared/contracts.ts";
import {createCoordinatorClient} from "../../src/worker/client.ts";

const apps: FastifyInstance[] = [];
async function server(route: (app: FastifyInstance) => void) {
  const app = Fastify(); apps.push(app); route(app);
  await app.listen({host: "127.0.0.1", port: 0});
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const session: WorkerSession = {workerId: "w1", token: "worker-token"};

test("claim maps only a 204 response to no work", async () => {
  const base = await server(app => app.post("/api/tasks/claim", async (_, reply) => reply.code(204).send()));
  await expect(createCoordinatorClient(base).claim(session, new AbortController().signal)).resolves.toBeNull();
});

test("an authentication error is surfaced without retry", async () => {
  let calls = 0;
  const base = await server(app => app.post("/api/tasks/claim", async (_, reply) => {
    calls++; return reply.code(401).send({error: {code: "UNAUTHORIZED", message: "bad token"}});
  }));
  await expect(createCoordinatorClient(base).claim(session, new AbortController().signal)).rejects.toMatchObject({code: "UNAUTHORIZED"});
  expect(calls).toBe(1);
});

test("a malformed successful lease is rejected as an engine protocol error", async () => {
  const base = await server(app => app.post("/api/tasks/claim", async () => ({taskId: "missing-fields"})));
  await expect(createCoordinatorClient(base).claim(session, new AbortController().signal)).rejects.toMatchObject({code: "ENGINE_ERROR"});
});

test("submit replay preserves the original immutable lease identity", async () => {
  const bodies: unknown[] = [];
  const base = await server(app => app.post("/api/tasks/:taskId/result", async request => {
    bodies.push(request.body);
    return {taskId: "t1", resultId: "r1", acceptedAt: 1000, credit: 1};
  }));
  const input: SubmitInput = {
    experimentId: "e1", taskId: "t1", leaseId: "l1", workerId: "w1",
    inferenceKey: "a".repeat(64), backend: "cpu",
    output: {text: "ANSWER: B", finishReason: "stop", inputTokens: 20, outputTokens: 4, inferenceMs: 100},
  };
  const client = createCoordinatorClient(base);
  await client.submit(session, input, new AbortController().signal);
  await client.submit(session, input, new AbortController().signal);
  expect(bodies).toEqual([input, input]);
});

test("caller cancellation is STOPPED rather than a network retry", async () => {
  const base = await server(app => app.post("/api/tasks/claim", async () => new Promise(() => {})));
  const controller = new AbortController();
  const pending = createCoordinatorClient(base).claim(session, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({code: "STOPPED"});
});

test("the fixed coordinator timeout is classified as NETWORK", async () => {
  const base = await server(app => app.post("/api/tasks/claim", async () => {
    await new Promise(resolve => setTimeout(resolve, 3000));
    return {late: true};
  }));
  await expect(createCoordinatorClient(base).claim(session, new AbortController().signal)).rejects.toMatchObject({code: "NETWORK"});
});

test("fault, release, and leave validate the coordinator acknowledgment body", async () => {
  const paths: string[] = [];
  const base = await server(app => {
    app.post("/api/tasks/:taskId/error", async request => { paths.push(request.url); return {ok: true}; });
    app.post("/api/tasks/:taskId/release", async request => { paths.push(request.url); return {ok: true}; });
    app.post("/api/workers/:workerId/leave", async request => { paths.push(request.url); return {ok: true}; });
  });
  const ref = {experimentId: "e1", taskId: "t1", leaseId: "l1", workerId: "w1"};
  const client = createCoordinatorClient(base);
  await expect(client.fault(session, {...ref, code: "INPUT_TOO_LONG", message: "too long"}, new AbortController().signal)).resolves.toBeUndefined();
  await expect(client.release(session, ref, new AbortController().signal)).resolves.toBeUndefined();
  await expect(client.leave(session, new AbortController().signal)).resolves.toBeUndefined();
  expect(paths).toEqual(["/api/tasks/t1/error", "/api/tasks/t1/release", "/api/workers/w1/leave"]);
});
