# Campus Compute Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将协调服务和真实 Worker 接成可用的网页流程，完成有证据的三分钟展示。

**Architecture:** 同一 React 构建根据 bootstrap.surface 呈现中央平台或本机控制页。系统指标由协调服务计算，网页仅呈现。基准以独立实验与统一放行执行，和正常用户实验分开。

**Tech Stack:** React、Vite、TypeScript；Node.js 基准脚本；已有 Fastify／Worker 协议。

**Spec:** [策划案](../specs/2026-09-11-campus-eval-design.md)；[总计划](2026-09-11-campus-compute-implementation.md)。负责人 C；D 主做 U2、U3，A／B 配合故障修复。

## Global Constraints

完整继承总计划 Global Constraints。模型固定、默认 200 题 × 3 模板；阶段比较使用共同已完成样本；失败、缓存和真实新计算分开；所有性能数字来自实际运行。中央网页没有远程提高机主档位的功能。以下开发与验收均未执行。

## Task U1：发布、报告、本机控制三个页面

**Files:** 创建 `src/web/index.html`、`main.tsx`、`App.tsx`、`api.ts`、`Publish.tsx`、`Experiment.tsx`、`Contribute.tsx`、`styles.css`、`tests/integration/http-flow.test.ts`。

**Interfaces:** `createApi(token:string):Api`；`Publish({api,onCreated})`；`Experiment({api,id,ownerToken})`；`Contribute({api})`。Api 为同源 HTTP 封装，返回总计划定义的响应；只使用固定 API 路径。

```ts
export interface Api {
  get<T>(path:string,signal?:AbortSignal):Promise<T>;
  post<T>(path:string,body:unknown,signal?:AbortSignal):Promise<T>;
}
export interface PublishProps {api:Api;onCreated:(created:Created)=>void}
export interface ExperimentProps {api:Api;id:string;ownerToken:string|null}
export interface ContributeProps {api:Api}
```

- [ ] **U1.1 建立页面入口及请求封装。** 中央平台先输入小组加入码；本机页面从 loopback bootstrap 得到控制 token。中央加入码和实验 ownerToken 可保留在 sessionStorage，不能放进 URL；本机 token 仅保留内存。

```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Campus Compute</title></head>
  <body><div id="root"></div><script type="module" src="/main.tsx"></script></body>
</html>
```

```ts
// api.ts
export class ApiError extends Error {
  constructor(public status:number,public code:string,message:string){super(message);}
}
export function createApi(token:string):Api {
  async function send<T>(method:string,path:string,body:unknown,signal?:AbortSignal):Promise<T> {
    if (!path.startsWith("/api/")) throw new Error("只允许平台 API 路径");
    const response=await fetch(path,{method,headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:method==="GET"?undefined:JSON.stringify(body),signal});
    const data=await response.json();
    if (!response.ok) throw new ApiError(response.status,data.error?.code??"UNKNOWN",data.error?.message??"Request failed");
    return data as T;
  }
  return {get:<T>(p:string,s?:AbortSignal)=>send<T>("GET",p,undefined,s),
    post:<T>(p:string,b:unknown,s?:AbortSignal)=>send<T>("POST",p,b,s)};
}
```

Api 用于页面端不调用 claim，不需处理 204。网络失败和业务错误显示在页面，不把旧状态变成成功。App 的 surface 来自服务器固定响应；本机端只有 Contribute，中央端只有 Publish／Experiment。URL hash `#/experiments/<id>` 只包含实验 ID，其他状态不泄漏在地址里。

```tsx
// main.tsx
import React from "react";
import {createRoot} from "react-dom/client";
import {App} from "./App.tsx";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
```

App 用 useEffect 加 AbortController 获取 bootstrap，并在 cleanup 取消；StrictMode 二次 effect 不得触发开始计算或发布实验。以上用户动作只来自按钮 handler。

- [ ] **U1.2 实现发布表单。** 先 GET datasets 和 defaults；选择内置题库或上传 JSONL；默认取内置已固定的 200 IDs，不能在浏览器重新随机抽样。少量调试可选前 20 条，报告仍记录实际 IDs。

```tsx
// Publish 中的提交函数；input 是按共享 CreateInput 维护的表单状态。
async function submitExperiment(input:CreateInput) {
  setBusy(true); setError(null);
  try {
    const preview=await api.post<Preview>("/api/experiments/preview",input);
    setPreview(preview);
    const created=await api.post<Created>("/api/experiments",input);
    sessionStorage.setItem(`owner:${created.experimentId}`,created.ownerToken);
    onCreated(created);
  } catch (error) {
    setError(error instanceof Error?error.message:"Unable to publish evaluation");
  } finally {setBusy(false);}
}
```

发布前预览应由单独 Preview 按钮触发并显示 total／fresh／cached；Submit 使用最新 input 再校验，按钮在 busy 时禁用。预览后编辑模板或题库立即使预览失效，避免提交时展示旧任务量。表单只支持 normal；benchmark 由 U2 脚本创建。

文件上传处理：先检查 File.size<=2,000,000，再读取 text，POST ImportInput；source 记录用户提供的来源或 `user-upload:<filename>`，未给许可则明确 `not-specified`，不能替用户声明许可。服务端以内容哈希固定 revision；返回行号错误时在文件名旁呈现。文件名、题目等用 React 文本节点渲染。

三张模板卡分别编辑 instruction，显示是否带两道固定例题；不允许通过页面切换任意模型。提交区域显示“200 questions × 3 prompts = 600 inference tasks”与实际缓存预览；没有设备速度数据时不填写预计分钟数。

- [ ] **U1.3 实现实验页面。** snapshot 每 2 秒查询一次，上一请求未完成时跳过本次；切换实验时取消旧请求，旧响应不得覆盖新页面。

```tsx
React.useEffect(()=>{
  const abort=new AbortController(); let busy=false;
  const refresh=async()=>{
    if(busy)return; busy=true;
    try {
      const next=await api.get<Snapshot>(`/api/experiments/${encodeURIComponent(id)}`,abort.signal);
      if(!abort.signal.aborted){setSnapshot(next);setConnectionError(null);setUpdatedAt(Date.now());}
    } catch(error) {
      if(!abort.signal.aborted)setConnectionError(error instanceof Error?error.message:"Connection lost");
    } finally {busy=false;}
  };
  void refresh(); const timer=setInterval(()=>{void refresh();},2000);
  return ()=>{abort.abort();clearInterval(timer);};
},[api,id]);
```

上方 api 必须由 useMemo 保持稳定，避免每次渲染重建轮询。连接失败保留最后快照并注明更新时间；隐藏 ETA 或标为过期，不能让离线页面继续自动递增完成量。

```tsx
// 质量比较表只展示服务端给出的共同分母。
const percentage=(n:number,d:number)=>d?`${(100*n/d).toFixed(1)}%`:"—";
<table>
  <thead><tr><th>Prompt</th><th>Accuracy</th><th>Format compliance</th><th>Received</th><th>Execution failures</th></tr></thead>
  <tbody>{snapshot.variants.map(v=><tr key={v.id}>
    <td>{v.id}</td><td>{percentage(v.commonCorrect,snapshot.commonCount)}</td>
    <td>{percentage(v.commonFormatOk,snapshot.commonCount)}</td>
    <td>{v.received}/{v.planned}</td><td>{v.failed}</td>
  </tr>)}</tbody>
</table>
```

页面布局：顶部实验名、mode 和完成状态；其次任务完成量与设备表；再显示明确标注共同样本数的模板比较；下方为最近任务事件和单题详情。source=cache 独立标识；每秒任务数注明时间窗口；积分不是 FLOPs。

点击“View answers”再获取完整 Report，不在每次 snapshot 轮询中下载所有原始输出。题目选择后并排显示各模板原始回答、解析答案、标准答案、格式判定与后端。Report.samples 和 rows 用 sampleId／variantId 关联；不靠数组当前位置关联。

JSON 导出使用 Blob 和临时对象 URL，下载后 revokeObjectURL；文件名包含 experimentId。加载此前报告时在醒目位置显示“Previously completed run”，不与当前快照合并。取消按钮仅在当前浏览器拥有 ownerToken 时提供，调用该 token 的 Api；已完成结果保留。

- [ ] **U1.4 实现本机贡献页面。** 配置表单包含协调地址、小组加入码、设备名称；引擎与模型路径通过本机配置文件提供，普通操作界面不展示完整私密路径。

```tsx
async function control(command:ControlCommand) {
  setPending(command.action);setError(null);
  try {setStatus(await api.post<LocalStatus>("/api/local/control",command));}
  catch(error){setError(error instanceof Error?error.message:"Control failed");}
  finally{setPending(null);}
}
<div className="actions">
  <button disabled={pending!==null || status.state==="initializing" || status.state==="stopping"}
    onClick={()=>{void control({action:"start"});}}>Start / Resume</button>
  <button disabled={pending!==null || status.state==="stopped"}
    onClick={()=>{void control({action:"pause"});}}>Pause after this task</button>
  <button disabled={pending==="exit" || status.state==="stopped"}
    onClick={()=>{void control({action:"exit"});}}>Exit now</button>
</div>
```

低／中／高各带一句具体解释：“Rest twice as long as the last inference”“Rest as long as the last inference”“Continue without an intentional break”。不得写成精确算力百分比。暂停显示 pausing，进程未结束显示 stopping，只有后端确认才显示 stopped。加载期间 Exit now 始终可用；不能因为 start 请求仍在等待而禁用退出。

本机 status 轮询采用与实验页相同的无重叠模式；页面关闭不会自动当作退出，页面文字明确“Use Exit now to stop contributing”。用户必须能在可见按钮或终端正常退出中停止计算。

- [ ] **U1.5 做一条 HTTP 完整流程测试与页面手工检查。** 不给每个按钮写镜像测试；自动化验证真实服务流程，界面重点人工操作。

```ts
// tests/integration/http-flow.test.ts
import {expect,test} from "vitest";
import {buildServer} from "../../src/server/app.ts";
import {fixture,testRegistration,submission} from "../fixtures/core.ts";
test("发布、推理结果回传、报告属于同一场实验",async()=>{
  const f=fixture();const app=buildServer({store:f.store,joinCode:"test-group"});
  const created=await app.inject({method:"POST",url:"/api/experiments",headers:{authorization:"Bearer test-group"},payload:f.input});
  expect(created.statusCode).toBe(200);
  const {experimentId}=created.json();const w=f.store.register(testRegistration);
  const claimed=await app.inject({method:"POST",url:"/api/tasks/claim",headers:{authorization:`Bearer ${w.token}`}});
  const lease=claimed.json();
  const accepted=await app.inject({method:"POST",url:`/api/tasks/${lease.taskId}/result`,headers:{authorization:`Bearer ${w.token}`},payload:submission(lease)});
  expect(accepted.statusCode).toBe(200);
  const reportResponse=await app.inject({method:"GET",url:`/api/experiments/${experimentId}/report`,headers:{authorization:"Bearer test-group"}});
  const report=reportResponse.json();
  expect(report.snapshot.state).toBe("completed");
  expect(report.rows[0].score.correct).toBe(true);
  expect(report.rows[0].taskId).toBe(lease.taskId);
  await app.close();f.store.close();
});
```

运行 `npm test -- tests/integration/http-flow.test.ts`、`npm run typecheck`、`npm run build:web`。手工检查：非法文件、重复点击发布、连接中断、共同分母为零、含失败完成、缓存命中、含 HTML 的题目按文本显示、加载中退出、窗口缩窄。使用比赛展示分辨率检查表格和大字是否清楚。提交 `feat: connect evaluation and contributor workflows`。

## Task U2：真实设备联合验收与两组基准

**Files:** 创建 `scripts/benchmark.ts`、`tests/integration/benchmark.test.ts`、`docs/validation/acceptance.md`、`docs/validation/devices.json`、`docs/validation/benchmark-method.md`；脚本执行后生成按 runId 区分的原始 JSON、完整报告和汇总。

**Interfaces:**

```ts
export interface BenchmarkConfig {
  coordinatorUrl:string;joinCode:string;datasetId:string;sampleIds:string[];
  variants:Variant[];singleWorkerId:string;allWorkerIds:string[];
  repeats:3;outputDir:string;
}
export interface BenchmarkRun {
  runId:string;condition:"single"|"pooled-dynamic"|"pooled-static";
  repeat:number;experimentId:string;workerIds:string[];
  startedAt:number;finishedAt:number;elapsedMs:number;
  fresh:number;failed:number;report:Report;
}
export function runBenchmark(config:BenchmarkConfig):Promise<BenchmarkRun[]>;
export function summarizeRuns(runs:BenchmarkRun[]):{condition:string;medianMs:number;minMs:number;maxMs:number}[];
```

U2 不远程修改机主的档位。参与者在自己的控制页设置 agreed level，并把实际设置记入 devices.json；基准配置只有服务器地址与设备 IDs，不包含别人本机控制 token。

- [ ] **U2.1 准备设备矩阵和逐项验收记录。** 每台记录别名、系统、CPU／GPU、内存、Node 版本、inferenceKey、backend、贡献档位、供电、前台负载、网络。最低配置 Mac 运行 10 分钟日常工作对照；Windows 至少 20 个真实任务。

acceptance.md 为 A01–A18 各建一行，字段为状态（未执行／通过／失败）、日期、设备、操作、预期、实测、证据文件。空证据不能写通过。记录真实的立即退出、网络中断、全部节点离开、协调服务重启；不以多个标签页代替多台物理设备。

- [ ] **U2.2 为基准算法写必要测试。** 防止缓存和失败任务污染时间对比；不测试与实现等价的静态文案。

```ts
import {expect,test} from "vitest";
import {median,assertComparable} from "../../scripts/benchmark.ts";
test("中位数和可比较条件",()=>{
  expect(median([900,100,200])).toBe(200);
  expect(()=>assertComparable({mode:"normal",cached:0,failed:0,expected:10,fresh:10})).toThrow();
  expect(()=>assertComparable({mode:"benchmark",cached:1,failed:0,expected:10,fresh:9})).toThrow();
  expect(()=>assertComparable({mode:"benchmark",cached:0,failed:1,expected:10,fresh:9})).toThrow();
});
```

```ts
export function median(values:number[]):number {
  if (!values.length) throw new Error("没有可汇总的数据");
  const sorted=[...values].sort((a,b)=>a-b), m=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;
}
export function assertComparable(v:{mode:string;cached:number;failed:number;expected:number;fresh:number}):void {
  if (v.mode!=="benchmark" || v.cached!==0 || v.failed!==0 || v.fresh!==v.expected)
    throw new Error("本次运行不满足完整真实计算条件");
}
```

- [ ] **U2.3 实现专用基准组织。** 使用专用协调数据目录，除待测 benchmark 外不混入用户实验。启动前清点模型均已加载、设备达到 ready，并保存生成参数和数据清单。最强单机根据单节点试跑选择，不凭 Windows 标签判断。

```ts
// benchmark.ts 的条件顺序：三轮交替，减小固定顺序影响。
const orders=[
  ["single","pooled-dynamic","pooled-static"],
  ["pooled-static","pooled-dynamic","single"],
  ["pooled-dynamic","single","pooled-static"],
] as const;
```

每个条件：POST benchmark CreateInput，held=true；single 的 workerIds 只有最强节点，其他两个为 allWorkerIds；static 用 policy=static，其余用 dynamic。创建成功后检查 snapshot 中列出的所需节点在线且配置一致，再用 ownerToken POST start。start 在协调服务记录 started_at 并释放 held；该时刻是统一测量起点。

轮询到 completed／completed-with-errors／canceled，下载 Report。elapsedMs=finished_at-started_at，两个时间都来自协调机。assertComparable 失败时保留报告、标记该轮无效，不纳入加速均值；不要用较早的失败结束时间冒充速度。创建请求响应不明时停止该轮，核对专用队列，不能盲目自动重试创建而留下额外负载。

每轮结束后等待所有参与设备完成规定的休息并重新 ready，下一轮才开始。脚本只组织已授权的基准实验，不在后台无限循环；达到配置的三轮即结束。按条件保存中位数与范围，计算 single / pooled-dynamic 加速比；另比较 pooled-static / pooled-dynamic。两组对照各自解释，不能混成一个倍率。

```ts
// summarizeRuns 的核心，只接收通过 assertComparable 的运行。
export function summarizeRuns(runs:BenchmarkRun[]) {
  const conditions=[...new Set(runs.map(r=>r.condition))];
  return conditions.map(condition=>{
    const ms=runs.filter(r=>r.condition===condition).map(r=>r.elapsedMs);
    return {condition,medianMs:median(ms),minMs:Math.min(...ms),maxMs:Math.max(...ms)};
  });
}
```

脚本入口用 `pathToFileURL(process.argv[1]).href === import.meta.url` 判断直接运行，避免测试导入时开始真实网络请求。命令为 `npm run benchmark -- --config config/local-benchmark.json`。输出配置中去掉 joinCode，保留公开实验指纹与设备别名。

- [ ] **U2.4 执行并解释结果。** 各条件默认三次、相同题目／模板／档位。冷启动另测；模型内部 cache_prompt=false，结果缓存也绕过。基准后用独立实验测试退出与断线，不把故障时间混进无故障对照。

如果多机未稳定胜过最强单机，保留原始结果并解释瓶颈；不修改单机档位或输出长度去制造提升。固定单并发的结论只适用于该配置，不能说胜过经过批处理优化的所有单机方案。汇总图从真实 JSON 生成，轴标“seconds per complete evaluation”并列出设备数。

- [ ] **U2.5 完成一次完整检查。** 运行 `npm test`、`npm run typecheck`、`npm run build:web`，只在新的改动／失败出现时重复相关检查。真机验收和自动化分别记录，提交 `test: validate heterogeneous evaluation and benchmark results`。

## Task U3：启动手册与三分钟交付

**Files:** 创建或完成 `docs/runbook.md`、`docs/demo-script.md`、`docs/validation/limitations.md`、`README.md`；保存真实报告与备份录像。

**Interfaces:** 面向队员的明确启动步骤；面向评委的 3 分钟故事；不增加新产品 API。

- [ ] **U3.1 写从干净环境启动的手册。** 明确固定 Node、`npm ci`、`npm run build:web`、引擎发行包、模型文件、公共 RuntimeLock、本机配置和协调地址。给出协调服务与两种 Worker 脚本的命令；运行数据目录必须在未同步的本机位置。

```sh
npm ci
npm run build:web
npm run server -- --config config/local-server.json
```

```sh
sh scripts/start-worker.sh /absolute/path/to/worker-config.json
```

```powershell
.\scripts\start-worker.ps1 -Config "C:\CampusCompute\worker-config.json"
```

路径参数由队员填为自己设备上的真实路径；手册列出 WorkerConfig 和服务配置各字段含义，注明 JSON 中 Windows 反斜杠要转义。示例文件不得包含真实加入码或私密令牌；公共清单可以随代码分享。

故障条目只覆盖已知问题：端口占用、引擎／DLL 缺失、模型哈希不同、网络不可达、上下文超限、进程未退出、lease 失效。每条提供观察点和恢复步骤；网络故障先显示未连接，不伪造空白结果为完成。

- [ ] **U3.2 按策划案第 16 节准备三分钟演讲。** 将真实 experimentId 填入讲解材料，明确直播和历史报告；模型提前加载；展示时优先主动退出恢复，突然断线证据作为已验收支撑。

| 时间 | 主屏内容 |
|---|---|
| 0:00–0:20 | 一道题、三个提示词、开发者为何需要批量回归 |
| 0:20–0:45 | 发布真实实验，出现待处理任务 |
| 0:45–1:15 | Mac 与 Windows 开始工作，显示真实完成量 |
| 1:15–1:45 | 一台主动退出，未完成任务由其他设备领取 |
| 1:45–2:15 | 当前题的模型回答、判分和阶段共同样本数 |
| 2:15–2:45 | 明确标为此前完成的报告和实际性能对比 |
| 2:45–3:00 | 跨系统、机主控制、可恢复的批量评测能力 |

积分使用普通新计算记录；如果现场重放已经完成过的相同计算，选择显式 benchmark 模式并说明这轮不加互助积分。不能清楚证明的节能、成本和加速数字不写进讲稿。

- [ ] **U3.3 两轮计时演练与备用方案。** 轮一从新实验开始跑完整流程；轮二切换备用网络并测试恢复。记录每个动作耗时，削减口头解释以控制总时长；不通过延长无用推理凑展示时间。录制备份时标明为录像，保留可用的已完成报告。
- [ ] **U3.4 检查提交物。** README 指向启动手册、架构、模型／数据来源、实际验证系统、报告与测量方法；limitations 区分功能已完成、未测后端和已知不足。确认源码／日志／录像中没有加入码、Worker token 或个人路径泄漏。正式提交或对外发布在实际开发完成后按赛事要求进行。
- [ ] **U3.5 完成团队交接。** A 核对队列与报告，B 核对设备与退出，C 核对网页与讲稿，D 核对数据和测量；记录 A01–A18 的最终状态。提交 `docs: package reproducible hackathon demo`。

## Delivery 完成证据

- [ ] 用户能从网页发布并取得真实结果，贡献者能在本机停止计算。
- [ ] 至少一台 Mac 与一台 Windows 有真实任务记录，8GB 体验及退出有实测证据。
- [ ] 两组基准与实际限制可追溯；三分钟展示不依赖 600 项全部现场完成。
- [ ] 文档、测试、真机测量与录像明确区分；开发未进行前不能提前勾选本清单。
