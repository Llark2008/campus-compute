# Campus Compute Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Mac 和 Windows 真正执行推理，并由机主可靠地开始、暂停和退出。

**Architecture:** Engine 管理本客户端拥有的原生进程；Runner 管理单任务循环与独立心跳；loopback 控制服务管理机主操作。引擎与协调客户端采用可注入接口，协议测试不依赖大模型。

**Tech Stack:** Node.js 24.21.0、TypeScript、llama.cpp、Fastify、Vitest；原生进程控制。

**Spec:** [策划案](../specs/2026-09-11-campus-eval-design.md)；[总计划及共享类型](2026-09-11-campus-compute-implementation.md)。负责人 B，D 配合真机与 Windows 验证。

## Global Constraints

完整继承总计划 Global Constraints。每机一个引擎进程和一个在途任务；推理不阻塞心跳；暂停允许当前题完成；立即退出必须结束拥有的推理进程。低／中／高为 2t／t／0 的工作间隔，不承诺 CPU／GPU 百分比。以下步骤尚未执行。

## Task W1：原生引擎、精确输入预检与真机探针

**Files:** 创建 `src/worker/config.ts`、`engine.ts`、`scripts/probe.ts`、`tests/worker/engine.test.ts`、`tests/fixtures/llama-server.ts`。真机探针生成 `config/runtime.lock.json`、`docs/validation/probe-<设备代号>.json`，设备代号来自机主设置的名称，不采集个人账号信息。

**Interfaces:**

```ts
export type EngineConfig=Pick<WorkerConfig,"backend"|"engineBin"|"enginePrefix"|"modelPath"|"enginePort"|"stateDir">;
export interface ProbeConfig extends EngineConfig {name:string;modelRepo:string;modelRevision:string}
export interface Engine {
  start(signal:AbortSignal):Promise<void>;
  infer(messages:Message[],generation:Generation,signal:AbortSignal):Promise<InferenceOutput>;
  stop():Promise<void>;
  pid():number|null;
  describe():Promise<{engineVersion:string;chatTemplate:string;totalSlots:number;contextSize:number}>;
}
export function createEngine(options:{config:EngineConfig;expected:RuntimeLock|null}):Engine;
export function hashFile(path:string):Promise<string>;
export function readWorkerConfig(path:string):WorkerConfig;
```

`expected:null` 只允许离线探针建立首份清单，Runner 必须使用实际 RuntimeLock。Engine.start 不注册节点、不接任务；这些由 W2 完成。

- [ ] **W1.1 在两系统准备同一模型和可用引擎。** 从 Qwen 官方仓库固定完整 commit 下载指定 GGUF，记录来源；从 llama.cpp 官方 release 选择同一发布版本的原生构建。Mac 使用 Metal，Windows 优先测试实际设备的 CUDA 构建，CPU 为可验证回退。保存完整发行包及其 DLL／动态库，不能只复制 exe 后丢掉依赖。

用 `engineBin` 和 `enginePrefix` 表达启动方式：独立 llama-server 使用空 prefix；若所选发布提供统一入口，按其帮助输出使用对应 serve prefix，并将这一差异写进清单。所有参数作为数组传给 spawn，不拼 shell 字符串。

```ts
// engine.ts 中的启动参数；模型路径和二进制路径均来自机主配置。
const args=[...config.enginePrefix,
  "--model",config.modelPath,"--host","127.0.0.1","--port",String(config.enginePort),
  "--ctx-size","2048","--parallel","1","--n-gpu-layers",config.backend==="cpu"?"0":"99",
  "--no-context-shift","--cache-ram","0","--no-cache-idle-slots",
];
```

先用实际二进制的 `--help` 检查这些选项；不支持时选择匹配文档的发行版本，不忽略未知参数。检查目标端口可独占使用；如果端口被占用则提示更换，不把别的本机模型服务当成自己启动成功。

- [ ] **W1.2 写引擎协议测试，再实现 adapter。** 模拟服务使用 Fastify 在随机 loopback 端口启动，提供 /health、/props、/apply-template、/tokenize、/completion；记录 received 请求，允许测试设定 tokenize 返回长度。它仅验证适配器，不能用于真机验收。

```ts
// tests/fixtures/llama-server.ts 的接口；实现返回测试原始请求供断言。
export interface FakeLlama {
  url:string;
  received:{path:string;body:unknown}[];
  setTokenCount(n:number):void;
  close():Promise<void>;
}
export function startFakeLlama():Promise<FakeLlama>;
```

```ts
// engine.ts 另导出纯 HTTP adapter，生产 Engine 也调用它。
export function inferAt(baseUrl:string,messages:Message[],generation:Generation,signal:AbortSignal):Promise<InferenceOutput>;
```

```ts
import { expect,test } from "vitest";
import { startFakeLlama } from "../fixtures/llama-server.ts";
import { inferAt } from "../../src/worker/engine.ts";
import { GENERATION } from "../../src/shared/limits.ts";
test("超限输入不能进入生成请求",async()=>{
  const fake=await startFakeLlama(); fake.setTokenCount(1921);
  await expect(inferAt(fake.url,[{role:"user",content:"test"}],GENERATION,new AbortController().signal)).rejects.toMatchObject({code:"INPUT_TOO_LONG"});
  expect(fake.received.filter(x=>x.path==="/completion")).toHaveLength(0);
  await fake.close();
});
```

运行 `npm test -- tests/worker/engine.test.ts`；先看到 adapter 未实现的失败。另测 1920 tokens 恰好可执行，以及 stop_type=limit 正确映射为 length。

- [ ] **W1.3 实现计数后使用同一 token 数组生成。** /apply-template 与 /tokenize 用同一引擎；不在前后端安装另一套 tokenizer 估算。以下返回结构先经 Zod 检查，不直接相信 JSON 强制类型转换。

```ts
import { z } from "zod";
import { DomainError } from "../shared/errors.ts";
import type { Message,Generation,InferenceOutput } from "../shared/contracts.ts";
const completionSchema=z.object({
  content:z.string(),stop_type:z.enum(["eos","word","limit"]),
  tokens_evaluated:z.number().int().nonnegative(),
  tokens_predicted:z.number().int().nonnegative().max(128),truncated:z.boolean(),
});
async function post(base:string,path:string,body:unknown,signal:AbortSignal):Promise<unknown> {
  const response=await fetch(new URL(path,base),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal});
  if (!response.ok) throw new DomainError("ENGINE_ERROR",`引擎返回 ${response.status}`);
  return response.json();
}
export async function inferAt(baseUrl:string,messages:Message[],generation:Generation,signal:AbortSignal):Promise<InferenceOutput> {
  const templated=z.object({prompt:z.string()}).parse(await post(baseUrl,"/apply-template",{messages},signal));
  const {tokens}=z.object({tokens:z.array(z.number().int())}).parse(await post(baseUrl,"/tokenize",{
    content:templated.prompt,add_special:false,parse_special:true,with_pieces:false,
  },signal));
  if (tokens.length+generation.maxTokens>generation.contextSize) throw new DomainError("INPUT_TOO_LONG","题目加输出预算超过上下文");
  const started=performance.now();
  const raw=completionSchema.parse(await post(baseUrl,"/completion",{
    prompt:tokens,stream:false,n_predict:generation.maxTokens,
    temperature:0,seed:generation.seed,cache_prompt:false,
    samplers:["temperature"],id_slot:0,
  },signal));
  const inferenceMs=performance.now()-started;
  if (raw.truncated) throw new DomainError("ENGINE_ERROR","引擎意外截断上下文");
  return {text:raw.content,finishReason:raw.stop_type==="limit"?"length":"stop",
    inputTokens:raw.tokens_evaluated,outputTokens:raw.tokens_predicted,inferenceMs};
}
```

此处 inferenceMs 包含本机生成 HTTP 的开销，排除分词预检、网络上传、下载与休息；所有设备使用相同口径。计数与输入 token 数不匹配时记录并排查，不偷偷增加上下文或使用截断参数。

固定 `samplers:["temperature"]`、预检与生成路径由 RuntimeLock 中的 `adapterVersion:"llama-completion-v1"` 标识，并纳入 inferenceKey。总计划已经包含该字段，所有参与设备一致；改变适配算法必须产生新指纹。

- [ ] **W1.4 实现进程所有权、启动失败和终止。** start 在 spawn 前安装 error／exit 监听；/health 就绪前持续检查进程仍存在。启动最多 60 秒，用户退出可随时取消；失败时清理自己创建的进程并返回明确错误。

```ts
import { spawn,execFile,type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync=promisify(execFile);
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export async function stopOwnedProcess(child:ChildProcess,exited:Promise<void>):Promise<void> {
  const pid=child.pid;
  if (!pid || child.exitCode!==null || child.signalCode!==null) return;
  if (process.platform==="win32") {
    try { await execFileAsync("taskkill",["/PID",String(pid),"/T","/F"],{windowsHide:true,timeout:1500}); }
    catch (error) { if (child.exitCode===null && child.signalCode===null) throw error; }
  } else {
    try { process.kill(-pid,"SIGTERM"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code!=="ESRCH") throw error;
    }
    await Promise.race([exited,delay(800)]);
    if (child.exitCode===null && child.signalCode===null) {
      try { process.kill(-pid,"SIGKILL"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code!=="ESRCH") throw error;
      }
    }
  }
  const ended=await Promise.race([exited.then(()=>true),delay(1000).then(()=>false)]);
  if (!ended) throw new Error("推理进程尚未确认退出");
}
```

Unix spawn 必须使用 detached=true 创建独立进程组；Windows 用 detached=false，直接启动 exe。shell=false，标准输入忽略，stdout／stderr 管道持续消费，最多保留最近 200 行不含题目与令牌的诊断。exited 在 spawn 时就建立，覆盖已经退出和 spawn error，不在 stop 时才开始监听。

引擎每次 start／stop 都串行管理同一 child 引用；stop 可中断启动等待，不能排在“等待模型加载完成”的长锁后面。只通过保存的 ChildProcess/PID 清理自己的进程，禁止按进程名结束全机 llama 服务。

- [ ] **W1.5 生成真实清单，并完成两系统 20 题探针。** 配置文件中的 repo、完整 modelRevision、modelPath、engineBin 均需有效；hashFile 流式读取，不能把 1.12 GB 一次性读进 JS 内存。

```ts
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
export async function hashFile(path:string):Promise<string> {
  const hash=createHash("sha256");
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest("hex");
}
```

describe 从 /props 读取 build_info、chat_template、total_slots 与 default_generation_settings.n_ctx；要求 total_slots=1、contextSize=2048，并用实际启动日志确认所选后端。语义清单取 modelSha256、engineVersion、chatTemplateSha256、GENERATION、adapterVersion，经 hashJson 生成 inferenceKey；每个平台二进制哈希另存 artifacts。第二台机器只能增加兼容 artifact，不能覆盖不一致的语义指纹。

probe 顺序固定：记录配置与系统信息 → 流式哈希 → start → describe → 一道自编短题预热 → 固定 20 道 ARC 真实生成 → 保存每题原始输出、token 数、耗时及冷启动时间 → finally stop。模型加载失败或任一协议不符退出非零，不写成功清单。准备脚本的命令格式：

```sh
npm run probe -- --config config/local-probe.json --lock config/runtime.lock.json --output docs/validation/probe-device.json
```

实际使用不同设备代号保存文件。探针读取 ProbeConfig；正常 Worker 读取 WorkerConfig，启动时从项目的 `config/runtime.lock.json` 加载已冻结清单。`config/local-probe.json` 与 `config/local-worker.json` 不入库；公共清单只包含二进制文件名，不包含机主的完整个人路径。8GB Mac 另外记录至少 10 分钟前台工作体验，Windows 记录真正测试过的 CPU／CUDA 路径。没有真机就保留未验证状态。

- [ ] **W1.6 运行 adapter 测试、typecheck，整理探针结果。** 提交 `feat: add verified native inference adapter`。不把模拟服务测试通过当作模型或 Windows 验收通过。

## Task W2：单任务循环、独立心跳与可中断控制

**Files:** 创建 `src/worker/client.ts`、`runner.ts`、`tests/worker/runner.test.ts`、`tests/worker/client.test.ts`、`tests/fixtures/worker.ts`。

**Interfaces:**

```ts
export interface CoordinatorClient {
  register(input:Registration,joinCode:string,signal:AbortSignal):Promise<WorkerSession>;
  heartbeat(session:WorkerSession,input:Heartbeat,signal:AbortSignal):Promise<HeartbeatReply>;
  claim(session:WorkerSession,signal:AbortSignal):Promise<Lease|null>;
  submit(session:WorkerSession,input:SubmitInput,signal:AbortSignal):Promise<Receipt>;
  release(session:WorkerSession,input:LeaseRef,signal:AbortSignal):Promise<void>;
  fault(session:WorkerSession,input:FaultInput,signal:AbortSignal):Promise<void>;
  leave(session:WorkerSession,signal:AbortSignal):Promise<void>;
}
export interface Runner {
  control(command:ControlCommand):Promise<LocalStatus>;
  status():LocalStatus;
  close():Promise<void>;
}
export function createCoordinatorClient(baseUrl:string):CoordinatorClient;
export function createRunner(options:{engine:Engine;client:CoordinatorClient;config:WorkerConfig;runtime:RuntimeLock;now?:()=>number}):Runner;
export function nextClaimAt(level:Level,acceptedAt:number,inferenceMs:number):number;
```

Runner 控制代码使用注入 now（默认 performance.now）和可取消计时器；协调服务给出的 remainingAttemptMs 转换为本机相对截止时间。连接重配仅在 stopped／error 且无自有进程时允许，同时重建 client。

- [ ] **W2.1 写暂停、退出和心跳并行的失败测试。** `tests/fixtures/worker.ts` 的 harness 使用可延迟完成的 Engine、按序返回任务的 CoordinatorClient、Vitest fake timers。暴露接口如下，内部记录每次 claim／submit／heartbeat／stop 调用：

```ts
export interface Harness {
  runner:Runner;
  calls:{claim:number;submit:number;heartbeat:number;stop:number};
  completeInference(output?:InferenceOutput):void;
  loseLease():void;
  acceptOnHeartbeat():void;
  advance(ms:number):Promise<void>;
  close():Promise<void>;
}
export function createHarness():Harness;
```

实现 completeInference 时，默认输出使用 `ANSWER: B`、20 输入 tokens、4 输出 tokens、100ms；loseLease 使下一次心跳返回无 receipt 的无效租约；acceptOnHeartbeat 返回当前 task 的 receipt，并让 submit 的首次 HTTP 确认丢失。模拟输出全部仅用于测试。

```ts
import {expect,test} from "vitest";
import {createHarness} from "../fixtures/worker.ts";
test("暂停完成当前题，生成期间心跳持续",async()=>{
  const h=createHarness();
  await h.runner.control({action:"start"}); await h.advance(1);
  await h.runner.control({action:"pause"});
  await h.advance(9000);
  expect(h.calls.heartbeat).toBeGreaterThanOrEqual(3);
  h.completeInference(); await h.advance(1);
  expect(h.calls.submit).toBe(1);
  expect(h.calls.claim).toBe(1);
  expect(h.runner.status().state).toBe("paused");
  await h.close();
});
test("立即退出调用引擎终止，不等当前生成自然结束",async()=>{
  const h=createHarness();
  await h.runner.control({action:"start"}); await h.advance(1);
  await h.runner.control({action:"exit"});
  expect(h.calls.stop).toBe(1);
  expect(h.runner.status().state).toBe("stopped");
  expect(h.calls.submit).toBe(0);
  await h.close();
});
```

运行 `npm test -- tests/worker/runner.test.ts`，在 Runner 尚未实现时失败。harness.start 后通过 advance 驱动启动，不用真实睡眠。

- [ ] **W2.2 实现 HTTP 客户端与明确错误分类。** 所有协调请求使用 2500ms 超时和调用方取消信号；JSON 成功响应校验为总计划对应结构；204 只在 claim 返回 null。5xx 或连接失败归 NETWORK；400／401／409 根据服务端 code 分别处理，不将身份失败无限重试。

```ts
async function request<T>(base:string,path:string,token:string,body:unknown,signal:AbortSignal):Promise<T|null> {
  let response:Response;
  try {
    response=await fetch(new URL(path,base),{method:"POST",
      headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(2500)])});
  } catch (error) {
    if (signal.aborted) throw new DomainError("STOPPED","请求已取消");
    throw new DomainError("NETWORK",error instanceof Error?error.message:"连接失败");
  }
  if (response.status===204) return null;
  const value=await response.json();
  if (!response.ok) {
    const code=response.status>=500?"NETWORK":value.error?.code;
    throw new DomainError(code??"ENGINE_ERROR",value.error?.message??`HTTP ${response.status}`);
  }
  return value as T;
}
```

上方 request 是传输核心；每个具体方法用 Zod 验证成功响应及错误 code 枚举后才返回，不让未知 JSON 被直接当作 Lease。URL 仅来自已校验的 coordinatorUrl 和固定路径，不能从任务里取得任意执行地址。

client.test 使用随机本地 HTTP 服务验证：claim 204、超时归 NETWORK、401 不重试、原 SubmitInput 重放不改变 leaseId，以及成功体字段缺失时报协议错误。

- [ ] **W2.3 实现工作节奏和生命周期。**

```ts
export function nextClaimAt(level:Level,acceptedAt:number,inferenceMs:number):number {
  const multiplier={low:2,medium:1,high:0}[level];
  return acceptedAt+multiplier*inferenceMs;
}
export async function waitAbortable(ms:number,signal:AbortSignal):Promise<void> {
  if (signal.aborted) throw new DomainError("STOPPED","等待取消");
  await new Promise<void>((resolve,reject)=>{
    const done=()=>{signal.removeEventListener("abort",abort);resolve();};
    const timer=setTimeout(done,Math.max(0,ms));
    const abort=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);reject(new DomainError("STOPPED","等待取消"));};
    signal.addEventListener("abort",abort,{once:true});
  });
}
```

Runner 内部状态明确分开：机主期望 `running|paused|stopped`、展示 state、当前 lease、pendingSubmit、已接受 taskId 集合、最后确认时刻与推理耗时、epoch。每次新会话和立即退出递增 epoch；旧异步操作结束时若 epoch 已变化，只清理自身，不改新会话状态或领取任务。

| 事件 | 实施动作 |
|---|---|
| start（stopped） | 立刻设置 initializing 并返回；异步校验清单、启动引擎、做一题本机试算；完成后 register、开始心跳和任务循环；任一步失败清理引擎并显示 error |
| start（paused） | 保留现有模型和会话，期望改 running，取消等待并重新计算可领时刻 |
| 领取 | 只有期望 running、无当前 lease／pendingSubmit、休息结束才调用；204 后等待 2 秒；NETWORK 暂停领取并退避 0.5／1／2 秒，保持可退出 |
| 生成 | 检查 inferenceKey；设置 computing；将 remainingAttemptMs 作为相对上限；等待 engine.infer 不持有控制锁 |
| 生成完成 | 设置 uploading，构造不可变 pendingSubmit；保留原 leaseId；提交成功进入统一 acknowledge |
| acknowledge | 同 taskId 只更新一次本地完成量；清空 lease 和 pendingSubmit，记录本机确认时刻与 inferenceMs；期望 paused 则 paused，否则 resting／ready |
| pause | 期望 paused，取消等待；在途任务显示 pausing 并继续提交；没有任务立即 paused |
| set-level | 更新 level；按最后确认时刻重新计算剩余休息，唤醒计时器；不修改当前题的推理参数 |
| exit | 期望 stopped、epoch++、state=stopping；取消启动／生成／等待，await engine.stop；再尽力 release、leave；只有 PID 已结束才 stopped，清理失败则 error |
| 生成超时 | 先结束自有引擎，报告 EXECUTION_TIMEOUT；需要继续时重新启动同一引擎后再领取；禁止旧生成仍在后台运行 |
| 确定性输入错误 | 报告 INPUT_TOO_LONG，当前题失败；不重试相同长输入 |

立即退出的本地终止不等待网络操作；进程确认结束后，release／leave 最多各请求一次，网络失败依靠服务端租约回收。无进程的控制页可继续运行；close 在退出后停止心跳与本机服务。

- [ ] **W2.4 实现独立心跳与确认丢失处理。** 使用独立计时器每 3 秒触发，heartbeat 请求未返回时跳过重叠触发；2500ms 请求超时防止积压。生成的 Promise 不能包住整个 heartbeat 循环。

```ts
// Runner 中 heartbeat 的响应顺序；acknowledge 与 abandonCurrent 为本任务下文定义的内部方法。
if (reply.receipt) {
  acknowledge(reply.receipt);
} else if (currentLease && !reply.leaseValid) {
  await abandonCurrent();
}
```

`acknowledge(receipt:Receipt):void` 先比对当前 taskId，再按上表去重；如果 submit 请求随后才返回相同 receipt，它没有第二次副作用。`abandonCurrent():Promise<void>` 取消当前请求、结束仍执行的引擎、清空失效 lease／pendingSubmit；如果机主仍愿意运行则重启引擎后继续，否则保留暂停或退出状态。

submit 的 NETWORK 失败重发完全相同的 pendingSubmit；不得重新运行模型。若与心跳确认竞争，两个入口共用 acknowledge。收到 LEASE_LOST 且没有成功 receipt 才丢弃旧结果。若心跳暂时失败而提交成功，可以正常结束这题，但下一次领取要先确认协调服务可达。

心跳返回已接受 receipt 的情况必须有核心 API 测试；服务端先校验 Worker 身份，不能让别的节点取走 receipt。新会话不能复用旧会话的 token 和 lease。

- [ ] **W2.5 补齐并运行交互竞争测试。** 覆盖：低档 2t、中档 t、高档 0；休息中切档、暂停、退出；模型加载时退出；反复点 start 不产生第二个引擎；心跳在生成期间继续；丢失 submit 确认由心跳恢复；receipt 两条路径只累计一次；失效 lease 停止旧生成；退出后旧 Promise 不改新会话状态。

```ts
test("贡献档位使用确认时刻与推理耗时",()=>{
  expect(nextClaimAt("low",1000,100)).toBe(1200);
  expect(nextClaimAt("medium",1000,100)).toBe(1100);
  expect(nextClaimAt("high",1000,100)).toBe(1000);
});
```

运行 `npm test -- tests/worker` 及 `npm run typecheck`；通过后与 C4 真实服务完成一题，提交 `feat: add interruptible worker scheduling and recovery`。

## Task W3：本机控制、原生启动与进程退出验收

**Files:** 创建 `src/worker/control.ts`、`main.ts`、`scripts/start-worker.sh`、`scripts/start-worker.ps1`、`tests/worker/control.test.ts`、`docs/validation/worker.md`；更新 `docs/runbook.md`。

**Interfaces:** `buildControlServer(options:{runner:Runner;port:number;token:string;webRoot:string}):FastifyInstance`。提供总计划中的 bootstrap、local/status、local/control；只监听 127.0.0.1。

- [ ] **W3.1 写本机身份与 Origin 测试。** 用 app.inject 发起缺 token、错 token、外部 Origin、伪造 Host 请求；均拒绝控制，Runner.control 调用次数保持 0。合法同源请求触发一次控制。

```ts
const token="fixture-local-token";
const response=await app.inject({method:"POST",url:"/api/local/control",
  headers:{host:"127.0.0.1:4317",origin:"https://unrelated.example",authorization:`Bearer ${token}`},
  payload:{action:"exit"}});
expect(response.statusCode).toBe(403);
expect(controlCalls).toBe(0);
```

- [ ] **W3.2 实现本机服务与页面启动。** token 来自 randomBytes(32)，仅在本机 bootstrap 返回；Host 精确限制到 `127.0.0.1:<port>` 或 `localhost:<port>`，不提供跨域访问。bootstrap 和静态页面也校验 Host，避免 DNS rebinding；不得把 token 写入分享链接。

```ts
const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
app.addHook("onRequest",async(req,reply)=>{
  if (!allowedHosts.has(req.headers.host??"")) return reply.code(403).send({error:{code:"UNAUTHORIZED",message:"本机地址不匹配"}});
});
app.post("/api/local/control",async(req,reply)=>{
  const origin=`http://${req.headers.host}`;
  if (req.headers.origin!==origin || req.headers.authorization!==`Bearer ${token}`)
    return reply.code(403).send({error:{code:"UNAUTHORIZED",message:"本机控制身份不匹配"}});
  return runner.control(ControlSchema.parse(req.body));
});
```

GET status 同样要求 token；bootstrap 不要求已有 token，但依赖 loopback、Host 检查和浏览器同源读取保护。配置与状态响应隐藏 joinCode、模型完整路径和私密会话令牌。本机页面使用已打包的同一 React 代码，surface=worker 时显示 Contribute。

- [ ] **W3.3 实现原生启动脚本和单实例保护。** main 用 `parseArgs` 读取 `--config`；持有 stateDir 内的独占锁文件，内容记录 PID 与随机启动标识。发现锁时若 PID 仍存在则拒绝第二个 Worker；确认 PID 已不存在才清理陈旧锁，不杀已有进程。退出释放自己的锁。

```sh
#!/usr/bin/env sh
set -eu
if [ "$#" -ne 1 ]; then
  echo "Usage: start-worker.sh /absolute/path/to/worker-config.json" >&2
  exit 2
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(dirname -- "$script_dir")
cd "$project_dir"
exec node --import tsx src/worker/main.ts --config "$1"
```

```powershell
param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
Push-Location $projectDir
try {
  & node --import tsx src/worker/main.ts --config $Config
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
```

安装步骤为安装固定 Node、`npm ci`、`npm run build:web`、准备同版本引擎和 GGUF、填写本机配置、运行对应脚本。脚本不关闭系统安全策略，不修改全机环境。首次控制页显示开始按钮，由机主点击才运行模型。

main 的 SIGINT／SIGTERM／正常控制退出流程先 await runner.close，再 app.close，最后释放单实例锁；不能先 process.exit 导致清理尚未发生。硬断电无法执行 cleanup，交给服务端租约恢复；现场材料区分两者。

- [ ] **W3.4 完成真机退出验证。** Mac 与 Windows 各测：生成期间点击立即退出、加载期间退出、终端正常关闭、恢复开始、第二实例被拒。用 Activity Monitor／Task Manager 与 PID 日志确认自有推理进程结束，记录目标 2 秒是否达成。Windows 记录 .exe 和依赖所在目录及 CPU／CUDA 验证结果。
- [ ] **W3.5 运行 worker 测试、typecheck 并交付记录。** 提交 `feat: ship local worker controls for macOS and Windows`；没有测试过的系统或后端不标通过。

## Worker 完成证据

- [ ] W1 两系统探针包含真实输出、哈希、引擎版本和已验证后端。
- [ ] W2 协议测试覆盖心跳、确认丢失与退出竞争，且至少一场真实评测完成。
- [ ] W3 机主控制独立于中央网页，退出有真实进程结束证据，8GB 体验记录可供团队判断。
