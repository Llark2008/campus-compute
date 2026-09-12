# Campus Compute Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可由真实 Worker 或协议测试客户端调用的持久评测服务。

**Architecture:** domain 层负责数据、提示词与评分；SQLite 保存状态；同步短事务处理任务分配与结果接受；Fastify 只承担协议边界。

**Tech Stack:** Node.js 24.21.0、TypeScript、Fastify、Zod、node:sqlite、Vitest。

**Spec:** [策划案](../specs/2026-09-11-campus-eval-design.md)；[总计划及共享类型](2026-09-11-campus-compute-implementation.md)。负责人 A，C2 由 D 主做。

## Global Constraints

完整继承总计划 Global Constraints。关键值：2048 上下文、128 输出、每机一题；心跳 3000ms、租约 20000ms、扫描 1000ms、执行 120000ms、最多 3 次故障。缓存及 benchmark 不计积分。下面的代码块是计划内容，尚未执行。

## Task C1：工程入口与协议边界

**Files:** 创建 `package.json`、`package-lock.json`、`.nvmrc`、`.gitignore`、`tsconfig.json`、`vite.config.ts`、`src/shared/contracts.ts`、`src/shared/limits.ts`、`src/shared/schemas.ts`、`src/shared/errors.ts`、`tests/core/schemas.test.ts`。

**Interfaces:** 输出总计划中全部类型和 LIMITS／GENERATION；HTTP 输入只通过本任务的 Zod schema 进入业务模块。

- [ ] **C1.1 建立可运行入口，安装并锁定依赖。** 使用已选 Node；以下命令仅在开发开始时执行。

```json
{
  "name": "campus-compute", "version": "0.1.0", "private": true,
  "type": "module", "engines": {"node": ">=24.21.0 <25"},
  "scripts": {
    "server": "node --import tsx src/server/main.ts",
    "worker": "node --import tsx src/worker/main.ts",
    "probe": "node --import tsx scripts/probe.ts",
    "prepare:arc": "node --import tsx scripts/prepare-arc.ts",
    "benchmark": "node --import tsx scripts/benchmark.ts",
    "dev:web": "vite --host 127.0.0.1",
    "build:web": "vite build", "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

```sh
npm install --save-exact fastify@5 @fastify/static@8 zod@4 react@19 react-dom@19
npm install --save-dev --save-exact typescript@5 tsx@4 vite@7 @vitejs/plugin-react@5 vitest@3 @types/node@24 @types/react@19 @types/react-dom@19
```

`.nvmrc` 内容为 `24.21.0`；`.gitignore` 包含 `node_modules/`、`dist/`、`.env`、`.runtime/`、`*.gguf`、`*.sqlite*`、`*.log`、`config/local*.json`。保留公共的 runtime.lock 和题库清单。

```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noEmit": true, "allowImportingTsExtensions": true,
    "jsx": "react-jsx", "esModuleInterop": true,
    "types": ["node", "vite/client"]
  },
  "include": ["src", "scripts", "tests", "vite.config.ts"]
}
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "src/web", plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
});
```

- [ ] **C1.2 写输入边界失败测试，再运行它。** 把总计划中的类型和参数写入对应文件；测试先缺少 schema 实现而失败。

```ts
import { expect, test } from "vitest";
import { SubmitSchema } from "../../src/shared/schemas.ts";
const input = {
  experimentId: "e1", taskId: "t1", leaseId: "l1", workerId: "w1",
  inferenceKey: "a".repeat(64), backend: "cpu",
  output: {text: "", finishReason: "stop", inputTokens: 10, outputTokens: 0, inferenceMs: 25},
};
test("空回答是可评分结果，非法耗时不是", () => {
  expect(SubmitSchema.safeParse(input).success).toBe(true);
  expect(SubmitSchema.safeParse({...input, output: {...input.output, inferenceMs: -1}}).success).toBe(false);
  expect(SubmitSchema.safeParse({...input, output: {...input.output, inferenceMs: Infinity}}).success).toBe(false);
  expect(SubmitSchema.safeParse({...input, output: {...input.output, text: "字".repeat(22000)}}).success).toBe(false);
});
```

运行 `npm test -- tests/core/schemas.test.ts`；预期先因导出不存在失败。

- [ ] **C1.3 实现边界 schema 与统一错误。** 所有 object 使用 strict，未知字段报错；前端请求不传 TypeScript 对象之外的可执行内容。

```ts
// src/shared/errors.ts
import type { ErrorCode } from "./contracts.ts";
export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string, public line?: number) {
    super(message); this.name = "DomainError";
  }
}
```

```ts
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
  sampleIds: z.array(id).min(1).max(1000), variants: z.array(VariantSchema).min(1).max(3),
  mode: z.enum(["normal", "benchmark"]),
  benchmark: z.object({policy: z.enum(["dynamic", "static"]), workerIds: z.array(id).min(1), held: z.boolean()}).strict().optional(),
}).strict().superRefine((v, c) => {
  if ((v.mode === "benchmark") !== Boolean(v.benchmark)) c.addIssue({code: "custom", message: "基准配置与模式不一致"});
  if (new Set(v.sampleIds).size !== v.sampleIds.length) c.addIssue({code: "custom", message: "重复题目 ID"});
  if (new Set(v.variants.map(x => x.id)).size !== v.variants.length) c.addIssue({code: "custom", message: "重复模板 ID"});
  if (v.benchmark && new Set(v.benchmark.workerIds).size !== v.benchmark.workerIds.length) c.addIssue({code: "custom", message: "重复基准设备"});
});
```

继续在同文件加入会话、返回值和本机控制边界；Worker 的 client 直接复用这些 schema 校验协调服务响应。

```ts
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
```

```ts
// 各 schema 实施时使用这种类型检查，防止请求字段与共享契约漂移。
import type { SubmitInput } from "./contracts.ts";
const submitContract: z.ZodType<SubmitInput> = SubmitSchema;
void submitContract;
```

- [ ] **C1.4 运行该测试及 typecheck。** 预期输入边界测试通过；未开始的模块不建立空占位文件来掩盖缺失。
- [ ] **C1.5 保存 C1 检查记录并提交这个工作单元。** 已有 Git 仓库时只暂存本任务文件，提交说明 `chore: establish shared evaluation protocol`；尚无仓库时保留文件交付，不为计划自动创建远程仓库。

## Task C2：题库、模板、评分与可复用计算身份

**Files:** 创建 `src/domain/dataset.ts`、`prompts.ts`、`score.ts`、`keys.ts`、`scripts/prepare-arc.ts`、`tests/core/evaluation.test.ts`；脚本执行后产生 `data/arc-demo.jsonl`、`arc-examples.json`、`arc-source.snapshot.json`、`dataset.lock.json`。

**Interfaces:** `normalizeRow(raw:unknown,line:number):Sample`；`parseJsonl(text:string):Sample[]`；`renderMessages(sample:PublicSample,variant:Variant):Message[]`；`scoreAnswer(text:string,sample:Sample,mode:ResponseMode):Score`；`hashJson(value:unknown):string`；`workKey(sample:PublicSample,variant:Variant,runtime:RuntimeLock):string`；`defaultVariants(examples:Sample[]):Variant[]`。

- [ ] **C2.1 写标签、评分和缓存身份的失败用例。**

```ts
import { expect, test } from "vitest";
import { normalizeRow } from "../../src/domain/dataset.ts";
import { scoreAnswer } from "../../src/domain/score.ts";
const raw = {id:"q1", question:"Which is liquid?", choices:[{label:"1",text:"Ice"},{label:"2",text:"Water"}], answerKey:"2"};
test("数字标签映射，答案与格式分别评分", () => {
  const sample = normalizeRow(raw, 1);
  expect(sample.answerKey).toBe("B");
  expect(sample.originalLabels).toEqual(["1", "2"]);
  expect(scoreAnswer("Because it flows.\nANSWER: B", sample, "answer-only"))
    .toEqual({answer:"B", correct:true, formatOk:false});
  expect(scoreAnswer("ANSWER: Z", sample, "explanation"))
    .toEqual({answer:null, correct:false, formatOk:false});
});
```

运行 `npm test -- tests/core/evaluation.test.ts`，先看到所需函数缺失的失败。

- [ ] **C2.2 实现解析与评分。** JSONL 空白行允许忽略，错误 line 始终使用原始文件行号；全部解析成功后才调用数据库导入事务。

```ts
// dataset.ts
import { RawSampleSchema } from "../shared/schemas.ts";
import { DomainError } from "../shared/errors.ts";
import type { Sample } from "../shared/contracts.ts";
export function normalizeRow(raw: unknown, line: number): Sample {
  const parsed = RawSampleSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues[0].message, line);
  const v = parsed.data;
  const labels = v.choices.map(c => c.label);
  const answerIndex = labels.indexOf(v.answerKey);
  if (new Set(labels).size !== labels.length || answerIndex < 0)
    throw new DomainError("VALIDATION", "标签重复或答案不存在", line);
  return {id:v.id, question:v.question, originalLabels:labels,
    choices:v.choices.map((c,i) => ({label:String.fromCharCode(65+i), text:c.text})),
    answerKey:String.fromCharCode(65+answerIndex)};
}
export function parseJsonl(text: string): Sample[] {
  if (Buffer.byteLength(text, "utf8") > 2_000_000) throw new DomainError("VALIDATION", "文件超过 2 MB");
  const samples: Sample[] = []; const seen = new Set<string>();
  for (const [i, line] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { throw new DomainError("VALIDATION", "无效 JSON", i+1); }
    const sample = normalizeRow(raw, i+1);
    if (seen.has(sample.id)) throw new DomainError("VALIDATION", "题目 ID 重复", i+1);
    seen.add(sample.id); samples.push(sample);
    if (samples.length > 1000) throw new DomainError("VALIDATION", "题目超过 1000", i+1);
  }
  if (!samples.length) throw new DomainError("VALIDATION", "题库为空");
  return samples;
}
```

```ts
// score.ts
import type { Sample, ResponseMode, Score } from "../shared/contracts.ts";
export function scoreAnswer(text: string, sample: Sample, mode: ResponseMode): Score {
  const trimmed = text.trim();
  const lines = trimmed.split(/\r?\n/).filter(s => s.trim().length > 0);
  const last = lines.at(-1) ?? "";
  const label = /^ANSWER: ([A-H])$/.exec(last)?.[1] ?? null;
  const answer = sample.choices.some(c => c.label === label) ? label : null;
  return {answer, correct:answer === sample.answerKey,
    formatOk:answer !== null && (mode === "explanation" || trimmed === last)};
}
```

- [ ] **C2.3 实现渲染、确定性哈希和默认模板，补上身份测试。** 当前题标准答案只能用于服务器评分，不能进入当前 user 消息。

```ts
// prompts.ts
import type { PublicSample, Sample, Variant, Message } from "../shared/contracts.ts";
const questionText = (s: PublicSample) => `${s.question}\n${s.choices.map(c => `${c.label}. ${c.text}`).join("\n")}`;
export function renderMessages(sample: PublicSample, variant: Variant): Message[] {
  const messages: Message[] = [{role:"system", content:variant.instruction}];
  for (const e of variant.examples) {
    messages.push({role:"user", content:questionText(e)}, {role:"assistant", content:`ANSWER: ${e.answerKey}`});
  }
  messages.push({role:"user", content:questionText(sample)});
  return messages;
}
export function defaultVariants(examples: Sample[]): Variant[] {
  if (examples.length !== 2) throw new Error("需要两道固定示例");
  const instruction = "Answer the science multiple-choice question. Return exactly one line: ANSWER: X, where X is the chosen option label.";
  return [
    {id:"A",name:"Direct answer",instruction,examples:[],responseMode:"answer-only"},
    {id:"B",name:"Two examples",instruction,examples,responseMode:"answer-only"},
    {id:"C",name:"Brief explanation",instruction:"Answer the science multiple-choice question. Explain briefly in one or two sentences. End with a separate line: ANSWER: X, where X is the chosen option label.",examples:[],responseMode:"explanation"},
  ];
}
```

```ts
// keys.ts
import { createHash } from "node:crypto";
import { renderMessages } from "./prompts.ts";
import type { PublicSample, Variant, RuntimeLock } from "../shared/contracts.ts";
function canonical(v: unknown): string {
  if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const r = v as Record<string, unknown>;
    return `{${Object.keys(r).sort().map(k => `${JSON.stringify(k)}:${canonical(r[k])}`).join(",")}}`;
  }
  throw new TypeError("哈希输入不是有限 JSON 值");
}
export const hashJson = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
export function workKey(sample: PublicSample, variant: Variant, runtime: RuntimeLock): string {
  return hashJson({question:sample.question,choices:sample.choices,
    messages:renderMessages(sample,variant), inferenceKey:runtime.inferenceKey, generation:runtime.generation});
}
```

新增测试：只改 sample.answerKey 不改变 workKey；修改题目、instruction 或 inferenceKey 必须改变；renderMessages 的最后一项不含 answerKey 字段；格式失败进入分母。RuntimeLock 使用 C3 明确标为测试的 fixture，不能混进实际清单。

- [ ] **C2.4 下载并保存真实数据快照。** 准备脚本调用 Hugging Face 官方 rows API，每页不超过 100 行；读取 validation 的全部 299 行，以及 train 中两个指定 ID，检查无 truncated_cells。数据来自服务器快照时 revision 记录为快照 SHA-256，而不是未经验证的 Git revision。[官方 rows API](https://huggingface.co/docs/dataset-viewer/rows)

```ts
// scripts/prepare-arc.ts 的下载与选取核心；写文件使用 node:fs/promises。
import { hashJson } from "../src/domain/keys.ts";
type ArcRow = {id:string;question:string;choices:{label:string[];text:string[]};answerKey:string};
async function fetchRows(split: string, stopIds?: Set<string>): Promise<ArcRow[]> {
  const rows: ArcRow[] = [];
  for (let offset = 0; ; offset += 100) {
    const query = new URLSearchParams({dataset:"allenai/ai2_arc",config:"ARC-Challenge",split,offset:String(offset),length:"100"});
    const response = await fetch(`https://datasets-server.huggingface.co/rows?${query}`, {signal:AbortSignal.timeout(30_000)});
    if (!response.ok) throw new Error(`ARC download: ${response.status}`);
    const page = await response.json() as {rows:{row:ArcRow;truncated_cells:string[]}[]};
    if (!Array.isArray(page.rows) || page.rows.some(r => r.truncated_cells?.length)) throw new Error("ARC 页面无效或被截断");
    rows.push(...page.rows.map(r => r.row));
    if (stopIds && [...stopIds].every(id => rows.some(r => r.id === id))) return rows;
    if (page.rows.length < 100) return rows;
  }
}
const validation = await fetchRows("validation");
if (validation.length !== 299) throw new Error("验证集数量发生变化，先核对数据版本");
const exampleIds = ["Mercury_SC_415702", "MCAS_2009_5_6516"];
const train = await fetchRows("train", new Set(exampleIds));
const examples = exampleIds.map(id => {
  const row = train.find(r => r.id === id);
  if (!row) throw new Error(`固定示例缺失：${id}`);
  return row;
});
const selected = validation.map(row => ({row,rank:hashJson([42,row.id])}))
  .sort((a,b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0).slice(0,200).map(x => x.row);
const toInput = (r:ArcRow) => {
  if (r.choices.label.length !== r.choices.text.length) throw new Error("ARC 选项未对齐");
  return {id:r.id,question:r.question,choices:r.choices.label.map((label,i) => ({label,text:r.choices.text[i]})),answerKey:r.answerKey};
};
```

将 selected 经 toInput 写为 JSONL，用 parseJsonl 再校验；examples 经 toInput 和 normalizeRow 写成两条 Sample。保存原始 validation／两条例题快照，清单记录下载时间、请求 URL、`revision: "viewer-snapshot:" + hashJson(snapshot)`、文件 SHA-256、种子 42、算法 `sha256-rank-v1`、选中 IDs 和 CC BY-SA-4.0。用 ID 清单重跑，不重新抽样。

- [ ] **C2.5 运行数据／评分测试与实际准备脚本。** 预期 200 条主数据、2 条示例、无重复 ID；查看任意一题原标签和标准答案映射。记录数据来源和文件哈希；提交 `feat: add reproducible evaluation data and scoring`。

## Task C3：持久任务、恢复和结果事务

**Files:** 创建 `src/server/schema.sql`、`db.ts`、`store.ts`、`experiments.ts`、`leases.ts`、`results.ts`、`auth.ts`、`tests/fixtures/core.ts`、`tests/core/queue.test.ts`、`tests/core/cache.test.ts`。

**Interfaces:** `createStore(options:{filename:string;runtime:RuntimeLock;examples:Sample[];now?:()=>number}):Store`。Store 的同步方法在本任务与 C4 完成，内部使用 DatabaseSync。

```ts
export interface Store {
  readonly runtime: RuntimeLock;
  importDataset(input:ImportInput):DatasetMeta;
  listDatasets():DatasetMeta[];
  defaultVariants():Variant[];
  preview(input:CreateInput):Preview;
  create(input:CreateInput):Created;
  register(input:Registration):WorkerSession;
  workerForToken(token:string):string;
  authorizeOwner(experimentId:string,token:string):void;
  heartbeat(workerId:string,input:Heartbeat):HeartbeatReply;
  claim(workerId:string):Lease|null;
  accept(workerId:string,input:SubmitInput):Receipt;
  release(workerId:string,input:LeaseRef):void;
  fault(workerId:string,input:FaultInput):void;
  leave(workerId:string):void;
  sweep():void;
  cancel(experimentId:string):void;
  start(experimentId:string):void;
  snapshot(experimentId:string):Snapshot;
  report(experimentId:string):Report;
  close():void;
}
```

- [ ] **C3.1 建立真实 SQLite 测试库与 schema。** 测试用 `:memory:`；恢复测试用操作系统临时目录中的实际文件。schema 与生产相同。

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY, meta_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS samples (
  dataset_id TEXT NOT NULL REFERENCES datasets(id), id TEXT NOT NULL,
  sample_json TEXT NOT NULL, PRIMARY KEY(dataset_id,id)
);
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL REFERENCES datasets(id),
  input_json TEXT NOT NULL, runtime_json TEXT NOT NULL, owner_hash TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('normal','benchmark')),
  held INTEGER NOT NULL DEFAULT 0, canceled_at INTEGER,
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
  last_dispatch INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
  registration_json TEXT NOT NULL, state TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'medium', last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id),
  sample_id TEXT NOT NULL, variant_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
  work_key TEXT NOT NULL, messages_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','leased','completed','failed','canceled')),
  faults INTEGER NOT NULL DEFAULT 0, assigned_worker TEXT REFERENCES workers(id),
  source TEXT CHECK(source IN ('computed','cache')),
  result_id TEXT REFERENCES results(id), score_json TEXT, error TEXT,
  completed_at INTEGER, UNIQUE(experiment_id,sample_id,variant_id)
);
CREATE INDEX IF NOT EXISTS task_queue ON tasks(experiment_id,state,ordinal);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  worker_id TEXT NOT NULL REFERENCES workers(id), state TEXT NOT NULL,
  started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL, ended_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS task_one_active ON attempts(task_id) WHERE state='active';
CREATE UNIQUE INDEX IF NOT EXISTS worker_one_active ON attempts(worker_id) WHERE state='active';
CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
  lease_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),
  worker_id TEXT NOT NULL REFERENCES workers(id), backend TEXT NOT NULL,
  output_json TEXT NOT NULL, receipt_json TEXT NOT NULL, accepted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS result_cache (
  work_key TEXT PRIMARY KEY, result_id TEXT NOT NULL REFERENCES results(id)
);
CREATE TABLE IF NOT EXISTS credits (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  worker_id TEXT NOT NULL REFERENCES workers(id), value INTEGER NOT NULL CHECK(value=1)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, experiment_id TEXT REFERENCES experiments(id),
  at INTEGER NOT NULL, kind TEXT NOT NULL, task_id TEXT, worker_id TEXT,
  detail TEXT NOT NULL
);
```

```ts
// db.ts
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
export function openDb(filename:string):DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  return db;
}
export function transaction<T>(db:DatabaseSync, fn:()=>T):T {
  db.exec("BEGIN IMMEDIATE");
  try { const value=fn(); db.exec("COMMIT"); return value; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
```

- [ ] **C3.2 写队列失败测试及共享 fixture。** fixture 使用虚构清单只做协议测试，不能输出为真机结果。`createStore` 的方法按上方接口实现后供所有测试使用。

```ts
// tests/fixtures/core.ts
import { GENERATION } from "../../src/shared/limits.ts";
import { createStore } from "../../src/server/store.ts";
import type { RuntimeLock, Registration, CreateInput, Lease, SubmitInput } from "../../src/shared/contracts.ts";
export const testRuntime:RuntimeLock = {
  adapterVersion:"llama-completion-v1",
  modelRepo:"test-only",modelRevision:"0".repeat(40),modelFile:"test-only.gguf",
  modelSha256:"0".repeat(64),engineVersion:"test-only",chatTemplateSha256:"0".repeat(64),
  generation:GENERATION,inferenceKey:"a".repeat(64),artifacts:[],
};
export const testRegistration:Registration = {name:"fixture",platform:"test",arch:"test",cpu:"test",memoryBytes:8_000_000_000,backend:"cpu",inferenceKey:testRuntime.inferenceKey};
export function fixture(filename=":memory:") {
  let time=1_000_000;
  const store=createStore({filename,runtime:testRuntime,examples:[],now:()=>time});
  const dataset=store.importDataset({name:"fixture",source:"test-only",revision:"test-only",license:"test-only",
    jsonl:JSON.stringify({id:"q1",question:"Which is liquid?",choices:[{label:"A",text:"Ice"},{label:"B",text:"Water"}],answerKey:"B"})});
  const input:CreateInput={name:"fixture",datasetId:dataset.id,sampleIds:["q1"],mode:"normal",
    variants:[{id:"A",name:"direct",instruction:"Answer with ANSWER: X",examples:[],responseMode:"answer-only"}]};
  return {store,input,advance:(ms:number)=>{time+=ms;},now:()=>time};
}
export function submission(lease:Lease):SubmitInput {
  return {experimentId:lease.experimentId,taskId:lease.taskId,leaseId:lease.leaseId,workerId:lease.workerId,
    inferenceKey:lease.inferenceKey,backend:"cpu",
    output:{text:"ANSWER: B",finishReason:"stop",inputTokens:20,outputTokens:4,inferenceMs:100}};
}
```

```ts
// tests/core/queue.test.ts
import { expect, test } from "vitest";
import { fixture, testRegistration, submission } from "../fixtures/core.ts";
test("失联重分配、迟到拒绝、成功重放不重复结算", () => {
  const f=fixture(); const {experimentId}=f.store.create(f.input);
  const a=f.store.register({...testRegistration,name:"a"});
  const b=f.store.register({...testRegistration,name:"b"});
  const first=f.store.claim(a.workerId)!;
  expect(f.store.claim(a.workerId)?.leaseId).toBe(first.leaseId);
  expect(f.store.claim(b.workerId)).toBeNull();
  f.advance(20_001); f.store.sweep();
  f.store.heartbeat(b.workerId,{state:"ready",level:"high",lease:null});
  const second=f.store.claim(b.workerId)!;
  expect(second.taskId).toBe(first.taskId);
  expect(second.leaseId).not.toBe(first.leaseId);
  expect(() => f.store.accept(a.workerId,submission(first))).toThrow();
  const receipt=f.store.accept(b.workerId,submission(second));
  f.advance(200_000);
  expect(f.store.accept(b.workerId,submission(second))).toEqual(receipt);
  const snapshot=f.store.snapshot(experimentId);
  expect(snapshot.fresh).toBe(1);
  expect(snapshot.workers.reduce((n,w)=>n+w.credits,0)).toBe(1);
  f.store.close();
});
```

运行 `npm test -- tests/core/queue.test.ts`，预期在事务业务尚未实现时失败。

- [ ] **C3.3 实现导入、预览与创建事务。** 全部样本／模板校验在事务前完成；未知 sampleId、重复 IDs、例题与待测题 ID 相同、非规范化例题标签均拒绝。`defaultVariants()` 在 examples 不足两题时抛错；fixture 直接传 input，不调用默认模板。

```ts
// experiments.ts 的任务展开算法；每个任务携带渲染消息，评分所需 Sample 留在数据库。
export function taskOrder(samples:Sample[],variants:Variant[]) {
  return samples.flatMap((sample,si) => variants.map((variant,vi) => ({
    sample,variant,ordinal:si*variants.length+vi,
  })));
}
```

事务顺序：写 experiment → 按 taskOrder 写任务 → 普通模式查 result_cache → 命中则引用原结果并用当前 Sample、responseMode 重新 scoreAnswer → 未命中 queued。benchmark 不查也不写缓存。创建返回管理令牌，数据库只保存 SHA-256 摘要。所有结果均缓存命中时立即记录 finished_at。

静态 benchmark 在创建时要求 workerIds 已注册且无重复，将按数量尽量均匀的连续任务区段绑定到 assigned_worker；动态 benchmark 不绑定单题但限制可领设备集合。普通任务 assigned_worker 为 null。held 基准只有 start 才允许领取；start 在事务中设置 started_at=now 并清除 held，不能等首个 Worker 轮询才开始计时。

- [ ] **C3.4 实现领取、心跳与恢复事务。** 下表是 leases.ts 的完整决策顺序；每个分支写入相应 Event。

| 操作 | 事务内规则 |
|---|---|
| claim | 先 sweep；核对 Worker 存在、未 stopping／stopped 且最近心跳不超过 20 秒；已有 active attempt 则返回原 Lease；否则选有可领任务、未取消、未 held 且与该 Worker inferenceKey 匹配的实验 |
| 公平顺序 | 实验按 last_dispatch、created_at、id；任务按 ordinal；静态任务必须 assigned_worker 匹配，benchmark 设备必须在清单中 |
| 领取写入 | 生成 leaseId，插入 active attempt；expires_at=now+20000，deadline_at=now+120000；任务置 leased；last_dispatch 改为全局最大值+1；首次领取设置 started_at |
| heartbeat | 总是更新合法会话 last_seen_at／state／level；只有身份、task、lease、未取消且两个期限均未过期才续期；expires_at=min(now+20000,deadline_at) |
| sweep | 找 active 且 expires_at<=now 或 deadline_at<=now；attempt 终结为 expired；task faults+1；第 3 次进入 failed，否则 queued |
| release | 只释放当前 Worker 的有效 active attempt；置 released、task queued；不加 faults；重复释放为幂等成功 |
| fault | 只处理当前 active attempt；INPUT_TOO_LONG／CONFIG_MISMATCH 确定性终结；ENGINE_ERROR／EXECUTION_TIMEOUT／NETWORK 计故障预算 |
| leave | 释放该 Worker 的 active attempt，然后标为 stopped；之后 heartbeat 不得自动把 stopped 会话复活，重新 start 需 register 新会话 |
| cancel | 实验 canceled_at=now；所有 queued／leased 改 canceled；active attempts 终结；保留已完成结果和 credits |

领取响应的 remainingLeaseMs／remainingAttemptMs 由协调服务当前时间计算。客户端不依赖跨机时钟同步。SQL 的两个部分唯一索引是重复领取的最终约束，不能仅靠内存 busy 标记。

heartbeat 在校验会话身份后先查该 lease 的成功 receipt；若已接受，返回 receipt 且 leaseValid=false，剩余时间为 0。其他响应 receipt=null。register 只在客户端完成本地准备后调用，初始 state=ready；stopping／stopped 会话禁止领取，已注销会话不能凭心跳复活。

```sql
-- 可领实验的排序核心；eligible 条件在查询中包括 assigned_worker 和 benchmark 清单。
SELECT e.id FROM experiments e
WHERE e.canceled_at IS NULL AND e.held=0
AND EXISTS (SELECT 1 FROM tasks t WHERE t.experiment_id=e.id AND t.state='queued'
  AND (t.assigned_worker IS NULL OR t.assigned_worker=?))
ORDER BY e.last_dispatch,e.created_at,e.id;
```

实现 `sweep` 时更新可终结实验的 finished_at；仅 queued 等待设备的实验不能被标为失败。重启重新打开数据库并启动扫描，不清空 tasks／results。

- [ ] **C3.5 实现结果接受事务。** `accept` 只接收 SubmitSchema 校验后的输入，且服务端派生的 workerId 必须与 input 一致。

```text
BEGIN IMMEDIATE
  1. 按 lease_id 查询 results：存在且 task／experiment／worker 相同，返回已存 receipt。
  2. 查询 active attempt + task + experiment + worker。
  3. 验证身份、task leased、两个期限均 > now、实验未取消、inferenceKey 与 backend 匹配。
  4. 用任务对应 Sample 和 Variant 对原始 text 评分；错误回答也继续保存。
  5. 插入 results；任务置 completed，source=computed，保存 result_id／score_json／completed_at。
  6. attempt 置 accepted、ended_at=now。
  7. normal：插入唯一 taskId credit；INSERT OR IGNORE result_cache；benchmark：两者都跳过。
  8. 写 accepted 事件，若所有任务终结则写 finished_at；返回已持久保存的 Receipt。
COMMIT；任何异常 ROLLBACK
```

同一租约但其他 Worker 的请求不得取得 receipt。重复成功提交的 receipt.credit 保留原值，调用方不能以 receipt.credit 每次回放再次本地累计；本地 completed 按 taskId 集合去重。

- [ ] **C3.6 添加关键故障与缓存用例，再运行本组测试。**

```ts
// tests/core/cache.test.ts
import { expect, test } from "vitest";
import { fixture, testRegistration, submission } from "../fixtures/core.ts";
test("缓存复用不增积分，基准强制计算且不写缓存", () => {
  const f=fixture(); const w=f.store.register(testRegistration);
  const first=f.store.create(f.input);
  const lease=f.store.claim(w.workerId)!;
  f.store.accept(w.workerId,submission(lease));
  const reused=f.store.create(f.input);
  expect(reused.preview.cached).toBe(1);
  expect(f.store.snapshot(reused.experimentId).fresh).toBe(0);
  const bench=f.store.create({...f.input,mode:"benchmark",benchmark:{policy:"dynamic",workerIds:[w.workerId],held:true}});
  expect(bench.preview.cached).toBe(0);
  expect(f.store.claim(w.workerId)).toBeNull();
  f.store.start(bench.experimentId);
  const bl=f.store.claim(w.workerId)!;
  expect(f.store.accept(w.workerId,submission(bl)).credit).toBe(0);
  expect(f.store.snapshot(first.experimentId).fresh).toBe(1);
  f.store.close();
});
```

另加明确用例：改 answerKey 后缓存输出重评分；改指令后 fresh=1；只做 benchmark 后 normal 仍 fresh=1；第 3 次故障终结；主动 release 三次不耗故障预算；两个实验轮转；只有一题时两个 Worker 不会各拿一份；accept 与 cancel 的两种先后顺序；真实文件数据库关闭重开后 receipt 可重放。恢复测试使用 `mkdtemp`，结束关闭数据库并删除本测试目录。

运行 `npm test -- tests/core/queue.test.ts tests/core/cache.test.ts`。全部通过后提交 `feat: persist leased evaluation tasks and idempotent results`。

## Task C4：HTTP、报告与服务启动

**Files:** 创建 `src/server/report.ts`、`app.ts`、`main.ts`、`tests/core/api.test.ts`、`tests/core/report.test.ts`；补齐 Store 的只读与鉴权方法。

**Interfaces:** `buildServer(options:{store:Store;joinCode:string;webRoot?:string}):FastifyInstance`；`comparison(rows:ReportRow[],variantIds:string[]):{commonIds:string[];variants:VariantSummary[]}`；Store.snapshot／report 的结构以总计划为准。

- [ ] **C4.1 写请求竞争与报告分母测试并确认失败。**

```ts
import { expect, test } from "vitest";
import { buildServer } from "../../src/server/app.ts";
import { fixture, testRegistration } from "../fixtures/core.ts";
test("两个认证请求不能抢到同一任务", async () => {
  const f=fixture(); f.store.create(f.input);
  const a=f.store.register(testRegistration), b=f.store.register({...testRegistration,name:"b"});
  const app=buildServer({store:f.store,joinCode:"test-group"});
  const responses=await Promise.all([a,b].map(w => app.inject({method:"POST",url:"/api/tasks/claim",headers:{authorization:`Bearer ${w.token}`}})));
  expect(responses.map(r=>r.statusCode).sort()).toEqual([200,204]);
  const denied=await app.inject({method:"POST",url:"/api/tasks/claim"});
  expect(denied.statusCode).toBe(401);
  await app.close(); f.store.close();
});
```

报告用例固定三题两模板：A 完成 q1、q2，B 完成 q1、q3；共同集合必须只有 q1。把 q1 的 B 输出设为不可解析，q1 仍留在分母。缓存行也属于已得结果，系统 failed 行不属于共同集合。

- [ ] **C4.2 实现报告聚合。** 不从硬件速度推断正确率；普通和 benchmark 都保留原始结果。

```ts
// report.ts：共同样本的纯函数核心
import type { ReportRow } from "../shared/contracts.ts";
export function commonSampleIds(rows:ReportRow[],variantIds:string[]):string[] {
  if (!variantIds.length) return [];
  const sets=variantIds.map(id => new Set(rows.filter(r => r.variantId===id && r.state==="completed" && r.output!==null).map(r=>r.sampleId)));
  return [...sets[0]].filter(id => sets.every(s=>s.has(id))).sort();
}
```

comparison 使用 commonSampleIds；每模板 received=completed 数、planned=该模板总任务数、failed=failed 数、truncated=finishReason 为 length 数；commonCorrect／commonFormatOk 只计共同集合。Snapshot.fresh 指已接受的新计算数，Preview.fresh 指创建时需要执行数，UI 必须用不同标签。

Snapshot 的 workers.completed／credits 按当前实验筛选。缓存引用的原 Worker 只能在详情中作为来源，不能计入当前贡献。events 最近 100 条；Report 则导出全量事件和 attempts。错误文本保留为普通文本。

吞吐：窗口起点=max(started_at,now-30000)，仅计算窗口内 source=computed 的首次接受数，除以实际窗口秒数；未启动或窗口长度为零时显示 0。ETA 要累计至少 10 个新结果、运行至少 30 秒且近期吞吐 >0，取 `(queued+leased)/throughput`；否则 null。接入／退出后清空估算，等新的 30 秒窗口再显示。

- [ ] **C4.3 按总计划端点表绑定路由和角色检查。** 使用下列注册器，逐条绑定到表中同名 Store 方法；参数 schema 的名称来自 C1。

```ts
import Fastify, {type FastifyRequest, type HTTPMethods} from "fastify";
import fastifyStatic from "@fastify/static";
import {createHash,timingSafeEqual} from "node:crypto";
import {ZodError,z} from "zod";
import { DomainError } from "../shared/errors.ts";
import {ImportSchema,CreateSchema,RegistrationSchema,HeartbeatSchema,SubmitSchema,LeaseRefSchema,FaultSchema} from "../shared/schemas.ts";
import type { Store } from "./store.ts";
export function buildServer({store,joinCode,webRoot}:{store:Store;joinCode:string;webRoot?:string}) {
  const app=Fastify({bodyLimit:4_200_000,logger:{redact:["req.headers.authorization"]}});
  const digest=(value:string)=>createHash("sha256").update(value).digest();
  const groupHash=digest(joinCode);
  const bearer=(r:FastifyRequest) => {
    const h=r.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw new DomainError("UNAUTHORIZED","需要身份令牌");
    return h.slice(7);
  };
  const wid=(r:FastifyRequest)=>store.workerForToken(bearer(r));
  const eid=(r:FastifyRequest)=>z.object({id:z.string().min(1).max(100)}).parse(r.params).id;
  const same=(a:string,b:string)=>{if(a!==b)throw new DomainError("VALIDATION","路径与请求身份不一致");};
  function bind(method:HTTPMethods,url:string,role:"group"|"worker"|"owner",run:(r:FastifyRequest)=>unknown) {
    app.route({method,url,handler:async(r,reply)=>{
      if (role==="group" && !timingSafeEqual(digest(bearer(r)),groupHash)) throw new DomainError("UNAUTHORIZED","加入码无效");
      if (role==="worker") wid(r);
      if (role==="owner") store.authorizeOwner(eid(r),bearer(r));
      const value=run(r);
      if (value===null) return reply.code(204).send();
      return value===undefined ? {ok:true} : value;
    }});
  }
  app.get("/api/bootstrap",()=>({surface:"coordinator"}));
  bind("GET","/api/datasets","group",()=>store.listDatasets());
  bind("GET","/api/defaults","group",()=>({variants:store.defaultVariants(),runtime:store.runtime}));
  bind("POST","/api/datasets","group",r=>store.importDataset(ImportSchema.parse(r.body)));
  bind("POST","/api/experiments/preview","group",r=>store.preview(CreateSchema.parse(r.body)));
  bind("POST","/api/experiments","group",r=>store.create(CreateSchema.parse(r.body)));
  bind("POST","/api/workers/register","group",r=>store.register(RegistrationSchema.parse(r.body)));
  bind("POST","/api/workers/:id/heartbeat","worker",r=>{const worker=wid(r);same(eid(r),worker);return store.heartbeat(worker,HeartbeatSchema.parse(r.body));});
  bind("POST","/api/tasks/claim","worker",r=>store.claim(wid(r)));
  bind("POST","/api/tasks/:id/result","worker",r=>{const input=SubmitSchema.parse(r.body);same(eid(r),input.taskId);same(wid(r),input.workerId);return store.accept(wid(r),input);});
  bind("POST","/api/tasks/:id/release","worker",r=>{const input=LeaseRefSchema.parse(r.body);same(eid(r),input.taskId);same(wid(r),input.workerId);return store.release(wid(r),input);});
  bind("POST","/api/tasks/:id/error","worker",r=>{const input=FaultSchema.parse(r.body);same(eid(r),input.taskId);same(wid(r),input.workerId);return store.fault(wid(r),input);});
  bind("POST","/api/workers/:id/leave","worker",r=>{same(eid(r),wid(r));return store.leave(wid(r));});
  bind("GET","/api/experiments/:id","group",r=>store.snapshot(eid(r)));
  bind("GET","/api/experiments/:id/report","group",r=>store.report(eid(r)));
  bind("POST","/api/experiments/:id/cancel","owner",r=>store.cancel(eid(r)));
  bind("POST","/api/experiments/:id/start","owner",r=>store.start(eid(r)));
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof ZodError)return reply.code(400).send({error:{code:"VALIDATION",message:error.issues[0]?.message??"输入无效"}});
    if(error instanceof DomainError){
      const status=error.code==="UNAUTHORIZED"?401:error.code==="NOT_FOUND"?404:
        ["LEASE_LOST","CONFIG_MISMATCH"].includes(error.code)?409:400;
      return reply.code(status).send({error:{code:error.code,message:error.message,line:error.line}});
    }
    request.log.error({message:error instanceof Error?error.message:"unknown error"},"request failed");
    return reply.code(500).send({error:{code:"ENGINE_ERROR",message:"服务内部错误"}});
  });
  if(webRoot)app.register(fastifyStatic,{root:webRoot,index:"index.html"});
  app.setNotFoundHandler((_request,reply)=>reply.code(404).send({error:{code:"NOT_FOUND",message:"接口或页面不存在"}}));
  return app;
}
```

上述路由已覆盖总计划的中央 API。Store 内部仍检查租约对应的 experiment／task／worker，防止调用者绕开 HTTP 门面时丢失一致性约束；heartbeat 的 body.lease.workerId 同样必须与认证主体一致。

`auth.ts` 用 `randomBytes(32).toString("base64url")` 产生 Worker／owner token，数据库保存 SHA-256。joinCode 如上在启动时转成摘要后比较。错误日志只保存必要原因，不能输出带 Authorization 或本机配置的完整请求。

使用 @fastify/static 提供构建后的网页，未知 `/api/*` 返回 JSON 404，不能返回 index.html。中央服务不注册任何 `/api/local/control` 路由。`onClose` 清理扫描计时器；数据库由 main 的退出流程关闭，测试可单独管理生命周期。

- [ ] **C4.4 实现可恢复启动。** `main.ts` 读取 `--config` 指向的本机 JSON，必需字段为 host、port、dataDir、joinCode、runtimeLockPath、datasetPath、examplesPath。dataDir 必须为绝对路径，按运行手册选本机未同步目录；模型不在服务器启动时下载。

```ts
// main.ts 中的启动与退出顺序
// config 的读取及字段校验先完成；store 和 app 均来自本计划定义的工厂。
const sweepTimer=setInterval(()=>store.sweep(),1000);
await app.listen({host:config.host,port:config.port});
let closing=false;
async function shutdown() {
  if (closing) return;
  closing=true; clearInterval(sweepTimer);
  await app.close(); store.close();
}
process.once("SIGINT",()=>{void shutdown();});
process.once("SIGTERM",()=>{void shutdown();});
```

首次启动按数据哈希检查内置题库，缺少才导入；重启不得重复创建实验。定时扫描恢复执行；存量未过期租约等待有效续期或到期，不清空所有状态。

- [ ] **C4.5 运行 core 全部测试及 typecheck，随后与 W2 做一次真实联调。** `npm test -- tests/core`、`npm run typecheck`。至少两种结果接收顺序、错误回放、缓存重评分、重启与共同分母通过后，提交 `feat: expose evaluation API and traceable reports`。

## Core 完成证据

- [ ] 保存测试命令、退出状态、测试数量和日期到 `docs/validation/core.md`，不预填通过。
- [ ] 记录一次真实 Worker 的 experimentId、taskId、resultId，确认 Report 包含对应原始回答。
- [ ] 与 B、C 共同核对总计划每条 API 的请求／响应；若调整字段，同时更新共享类型和所有调用方。
