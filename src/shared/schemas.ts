// src/shared/schemas.ts：公共基础和结果边界
import { z } from "zod";
import { LIMITS } from "./limits.ts";
const text = (max: number) => z.string().refine(s => [...s].length <= max, "文本超限");
const id = z.string().min(1).max(100);
const count = z.number().int().nonnegative();
export const ChoiceSchema = z.object({label: id, text: text(LIMITS.maxChoiceChars).refine(s => s.trim().length > 0)}).strict();
export const RawSampleSchema = z.object({
  id, question: text(LIMITS.maxQuestionChars).refine(s => s.trim().length > 0),
  choices: z.array(ChoiceSchema).min(2).max(8), answerKey: id,
}).strict();
export const SampleSchema = RawSampleSchema.extend({originalLabels: z.array(id).min(2).max(8)});
export const VariantSchema = z.object({
  id, name: z.string().min(1).max(100), instruction: text(6000).refine(s => s.trim().length > 0),
  examples: z.array(SampleSchema).max(2), responseMode: z.enum(["answer-only", "explanation"]),
}).strict();
export const LeaseRefSchema = z.object({experimentId: id, taskId: id, leaseId: id, workerId: id}).strict();
export const OutputSchema = z.object({
  text: z.string().refine(s => new TextEncoder().encode(s).length <= LIMITS.maxOutputBytes),
  finishReason: z.enum(["stop", "length"]), inputTokens: count,
  outputTokens: count.max(128), inferenceMs: z.number().finite().nonnegative(),
}).strict();
export const SubmitSchema = LeaseRefSchema.extend({
  inferenceKey: z.string().regex(/^[a-f0-9]{64}$/),
  backend: z.enum(["metal", "cuda", "cpu"]), output: OutputSchema,
});
export const ImportSchema = z.object({
  name: z.string().min(1).max(100), jsonl: z.string(),
  source: z.string().max(2000), revision: z.string().max(200), license: z.string().max(200),
}).strict();
export const CreateSchema = z.object({
  name: z.string().min(1).max(100), datasetId: id,
  sampleIds: z.array(id).min(1).max(LIMITS.maxSamples), variants: z.array(VariantSchema).min(1).max(3),
  mode: z.enum(["normal", "benchmark"]),
  benchmark: z.object({policy: z.enum(["dynamic", "static"]), workerIds: z.array(id).min(1), held: z.boolean()}).strict().optional(),
}).strict().superRefine((v, c) => {
  if ((v.mode === "benchmark") !== Boolean(v.benchmark)) c.addIssue({code: "custom", message: "基准配置与模式不一致"});
  if (new Set(v.sampleIds).size !== v.sampleIds.length) c.addIssue({code: "custom", message: "重复题目 ID"});
  if (new Set(v.variants.map(x => x.id)).size !== v.variants.length) c.addIssue({code: "custom", message: "重复模板 ID"});
  if (v.benchmark && new Set(v.benchmark.workerIds).size !== v.benchmark.workerIds.length) c.addIssue({code: "custom", message: "重复基准设备"});
});
export const BackendSchema=z.enum(["metal","cuda","cpu"]);
export const LevelSchema=z.enum(["low","medium","high"]);
export const WorkerStateSchema=z.enum(["initializing","ready","computing","uploading","resting","pausing","paused","stopping","stopped","error","offline"]);
export const ErrorCodeSchema=z.enum(["VALIDATION","UNAUTHORIZED","NOT_FOUND","LEASE_LOST","CONFIG_MISMATCH","INPUT_TOO_LONG","ENGINE_ERROR","EXECUTION_TIMEOUT","NETWORK","STOPPED"]);
const sha256=z.string().regex(/^[a-f0-9]{64}$/);
export const GenerationSchema=z.object({contextSize:z.literal(2048),maxTokens:z.literal(128),temperature:z.literal(0),seed:z.literal(42),cachePrompt:z.literal(false)}).strict();
export const MessageSchema=z.object({role:z.enum(["system","user","assistant"]),content:z.string()}).strict();
export const RuntimeLockSchema=z.object({
  adapterVersion:z.literal("llama-completion-v1"),modelRepo:z.string().min(1),
  modelRevision:z.string().regex(/^[a-f0-9]{40}$/),modelFile:z.string().min(1),
  modelSha256:sha256,engineVersion:z.string().min(1),chatTemplateSha256:sha256,
  generation:GenerationSchema,inferenceKey:sha256,
  artifacts:z.array(z.object({platform:z.string(),arch:z.string(),backend:BackendSchema,
    binarySha256:sha256,executable:z.string().min(1),prefix:z.array(z.string())}).strict()),
}).strict();
export const RegistrationSchema=z.object({
  deviceId:z.string().uuid().optional(),
  name:z.string().min(1).max(100),platform:z.string().min(1).max(100),arch:z.string().min(1).max(100),
  cpu:z.string().max(500),memoryBytes:z.number().int().positive(),backend:BackendSchema,inferenceKey:sha256,
}).strict();
export const WorkerSessionSchema=z.object({workerId:id,token:z.string().min(1)}).strict();
export const LeaseSchema=LeaseRefSchema.extend({inferenceKey:sha256,messages:z.array(MessageSchema).min(1),
  generation:GenerationSchema,remainingLeaseMs:count.max(20000),remainingAttemptMs:count.max(120000)});
export const ReceiptSchema=z.object({taskId:id,resultId:id,acceptedAt:count,credit:z.union([z.literal(0),z.literal(1)])}).strict();
export const HeartbeatSchema=z.object({state:WorkerStateSchema,level:LevelSchema,lease:LeaseRefSchema.nullable()}).strict();
export const HeartbeatReplySchema=z.object({leaseValid:z.boolean(),remainingLeaseMs:count.max(20000),remainingAttemptMs:count.max(120000),receipt:ReceiptSchema.nullable()}).strict();
export const FaultSchema=LeaseRefSchema.extend({code:ErrorCodeSchema,message:text(2000)});
const coordinatorUrl=z.string().url().refine(value=>{
  const url=new URL(value);
  return ["http:","https:"].includes(url.protocol) && !url.username && !url.password;
});
export const ControlSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("configure"),coordinatorUrl,joinCode:z.string().min(1),name:z.string().min(1).max(100)}).strict(),
  z.object({action:z.literal("start")}).strict(),z.object({action:z.literal("pause")}).strict(),
  z.object({action:z.literal("exit")}).strict(),z.object({action:z.literal("set-level"),level:LevelSchema}).strict(),
]);
