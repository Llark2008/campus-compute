import {readFileSync} from "node:fs";
import {z} from "zod";
import type {WorkerConfig} from "../shared/contracts.ts";
import {BackendSchema} from "../shared/schemas.ts";
import {DomainError} from "../shared/errors.ts";

const workerConfigSchema = z.object({
  coordinatorUrl: z.string().url().refine(value => {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  }, "协调地址必须是无凭据的 HTTP(S) URL"),
  joinCode: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  backend: BackendSchema,
  engineBin: z.string().min(1),
  enginePrefix: z.array(z.string()),
  modelPath: z.string().min(1),
  enginePort: z.number().int().min(1024).max(65535),
  controlPort: z.number().int().min(1024).max(65535),
  stateDir: z.string().min(1),
}).strict().refine(value => value.enginePort !== value.controlPort, "引擎和控制端口必须不同");

export function parseWorkerConfig(value: unknown): WorkerConfig {
  const parsed = workerConfigSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION", `Worker 配置无效：${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function readWorkerConfig(path: string): WorkerConfig {
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new DomainError("VALIDATION", `无法读取 Worker 配置：${error instanceof Error ? error.message : String(error)}`); }
  return parseWorkerConfig(value);
}
