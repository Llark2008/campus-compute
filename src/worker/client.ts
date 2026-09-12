import {z, type ZodType} from "zod";
import type {FaultInput, Heartbeat, HeartbeatReply, Lease, LeaseRef, Receipt, Registration, SubmitInput, WorkerSession} from "../shared/contracts.ts";
import {DomainError} from "../shared/errors.ts";
import {ErrorCodeSchema, HeartbeatReplySchema, LeaseSchema, ReceiptSchema, WorkerSessionSchema} from "../shared/schemas.ts";

export interface CoordinatorClient {
  register(input: Registration, joinCode: string, signal: AbortSignal): Promise<WorkerSession>;
  heartbeat(session: WorkerSession, input: Heartbeat, signal: AbortSignal): Promise<HeartbeatReply>;
  claim(session: WorkerSession, signal: AbortSignal): Promise<Lease | null>;
  submit(session: WorkerSession, input: SubmitInput, signal: AbortSignal): Promise<Receipt>;
  release(session: WorkerSession, input: LeaseRef, signal: AbortSignal): Promise<void>;
  fault(session: WorkerSession, input: FaultInput, signal: AbortSignal): Promise<void>;
  leave(session: WorkerSession, signal: AbortSignal): Promise<void>;
}

const errorSchema = z.object({error: z.object({code: ErrorCodeSchema, message: z.string()}).strict()}).strict();
const acknowledgmentSchema = z.object({ok: z.literal(true)}).strict();

function protocol<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainError("ENGINE_ERROR", `协调服务响应协议无效：${z.prettifyError(result.error)}`);
  return result.data;
}

async function request(base: string, path: string, token: string, body: unknown, signal: AbortSignal): Promise<unknown | null> {
  let response: Response;
  try {
    response = await fetch(new URL(path, base), {
      method: "POST",
      headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
      body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]),
    });
  } catch (error) {
    if (signal.aborted) throw new DomainError("STOPPED", "请求已取消");
    throw new DomainError("NETWORK", error instanceof Error ? error.message : "连接失败");
  }
  if (response.status === 204) return null;
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new DomainError(response.status >= 500 ? "NETWORK" : "ENGINE_ERROR", `HTTP ${response.status} 返回的不是 JSON`); }
  if (!response.ok) {
    if (response.status >= 500) throw new DomainError("NETWORK", `协调服务返回 ${response.status}`);
    const parsed = errorSchema.safeParse(value);
    if (!parsed.success) throw new DomainError("ENGINE_ERROR", `协调服务错误响应协议无效：${z.prettifyError(parsed.error)}`);
    throw new DomainError(parsed.data.error.code, parsed.data.error.message);
  }
  return value;
}

function required<T>(schema: ZodType<T>, value: unknown | null): T {
  if (value === null) throw new DomainError("ENGINE_ERROR", "协调服务意外返回 204");
  return protocol(schema, value);
}

function acknowledged(value: unknown | null): void {
  required(acknowledgmentSchema, value);
}

export function createCoordinatorClient(baseUrl: string): CoordinatorClient {
  let base: string;
  try {
    const url = new URL(baseUrl);
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) throw new Error("invalid protocol or credentials");
    base = url.href;
  } catch { throw new DomainError("VALIDATION", "协调服务地址无效"); }
  const worker = (session: WorkerSession) => encodeURIComponent(session.workerId);
  return {
    async register(input: Registration, joinCode: string, signal: AbortSignal) {
      return required(WorkerSessionSchema, await request(base, "/api/workers/register", joinCode, input, signal));
    },
    async heartbeat(session: WorkerSession, input: Heartbeat, signal: AbortSignal): Promise<HeartbeatReply> {
      return required(HeartbeatReplySchema, await request(base, `/api/workers/${worker(session)}/heartbeat`, session.token, input, signal));
    },
    async claim(session: WorkerSession, signal: AbortSignal): Promise<Lease | null> {
      const value = await request(base, "/api/tasks/claim", session.token, {}, signal);
      return value === null ? null : protocol(LeaseSchema, value);
    },
    async submit(session: WorkerSession, input: SubmitInput, signal: AbortSignal): Promise<Receipt> {
      return required(ReceiptSchema, await request(base, `/api/tasks/${encodeURIComponent(input.taskId)}/result`, session.token, input, signal));
    },
    async release(session: WorkerSession, input: LeaseRef, signal: AbortSignal) {
      acknowledged(await request(base, `/api/tasks/${encodeURIComponent(input.taskId)}/release`, session.token, input, signal));
    },
    async fault(session: WorkerSession, input: FaultInput, signal: AbortSignal) {
      acknowledged(await request(base, `/api/tasks/${encodeURIComponent(input.taskId)}/error`, session.token, input, signal));
    },
    async leave(session: WorkerSession, signal: AbortSignal) {
      acknowledged(await request(base, `/api/workers/${worker(session)}/leave`, session.token, {}, signal));
    },
  };
}
