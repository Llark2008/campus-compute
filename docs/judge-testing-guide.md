# 给评委的测试与三分钟展示

本轮功能：保留原200道 ARC-Challenge validation题，新增完整1,172道test题；页面可选20/200/500/1000/全部或填写整数。题量是“问题数”，实际推理任务数为问题数×提示词数。完整新题库搭配3个提示词是3,516项任务。自定义JSONL上限2,000题、2MB。

## 先做有说服力的比较

需求场景是团队反复修改提示词后，需要对固定题库进行完整回归评测。每次真实修改会产生新的推理工作；多台闲置电脑并行处理独立题目，目标是缩短一轮评测的等待时间。不要只展示一个题目回答得很快，也不要把模型准确率的变化解释成多机加速带来的效果。

建议用 **新test题库中的同一500题×相同3提示词=1,500项任务**，先试20题检查连接，再跑正式测试。如果500题耗时超出你们准备时间，可统一降为200题；所有比较组必须一起改。全量1,172题适合提前长跑，没必要在3分钟内等它算完。

| 测试 | 设备和设置 | 留下的证据 |
| --- | --- | --- |
| 单机基线 | 分别测候选电脑，选择实测最快的一台；固定档位 | 相同工作量的完成时间和报告 |
| 两机/四机协作 | 包含基线电脑，完全相同的题目、提示词、模型和档位 | 各设备接受的结果数量，总完成时间 |
| 动态调度对照 | 同一组设备，静态分配与动态领取 | 异构设备下慢节点造成的尾部等待是否减轻 |
| 中途退出恢复 | 单独的新一轮，多机运行时让一台正在计算的节点退出 | 未完成任务被重新领取，其他节点继续，最后无丢题 |

正式速度测试各条件重复3遍，交替顺序，报告中位数，同时保留每次原始数据。所有设备先加载模型并热身、接电，固定前台活动和网络。用于真实性展示的退出、改档位和重连测试单独进行，不混进无故障加速表。

## 三种时间，不要混用

- **Total elapsed time / total_elapsed_seconds**：从发布到结束，包括排队、等待模型、暂停。结束或取消后固定。
- **Execution elapsed time / execution_elapsed_seconds**：从第一项任务派发到结束，包括之后的暂停和重试。任务尚未派发、全部命中缓存时是“—”，CSV为空；不是零秒推理。
- **benchmark_release_elapsed_seconds**：正式基准脚本在全部设备准备好后统一放行，到最后任务完成的时间。脚本的summary使用这个口径；它还包含放行后等待首次领取的时间，不能和前两列混着算倍率。

正常手动发布、设备已热身且无其他排队任务时，可用Execution elapsed time作初步观察。**正式证明速度请使用下方benchmark脚本关闭缓存**。不要通过只改评测名称规避缓存，也不要为规避缓存而修改提示词；前者无效，后者会改变工作量。

页面中点击 **View answers → Export comparison CSV** 导出一行摘要；Export JSON保留逐题答案、设备和尝试记录。把每一轮CSV的第二行放入同一表，表头只留一份。CSV时间以秒记录，精度保留到毫秒。

推荐对比表：条件、物理设备数、题目数、提示词数、Fresh、Cached、耗时1/2/3、中位数、加速倍数、失败数。加速倍数=单机中位数÷多机中位数。应有Cached=0、Fresh=计划任务数、失败=0；正式无故障比较还要求每项任务只有一次accepted尝试。保留CSV中的workload_fingerprint和inference_key，核对各组完全相同。

## 使用现有正式基准脚本

脚本已有三组×三次交替运行：最强单机、动态多机、静态多机。队伍若只展示单机和多机，表中取前两种条件；第三种可辅助解释optimization。脚本只在每组都取得3次有效结果后计算倍率；中断或故障报告会保存并排除。

1. 使用至少两台已经Start并完成热身的真实设备，所有待测设备保持Ready。建议单独的协调数据库，或先确保当前协调端没有其他排队任务。
2. 以组加入码认证读取`GET /api/workers`。这列出当前连接的设备，与评测页只展示已贡献设备的列表分开。记录它们的id；重新启动贡献会产生新会话时需要更新配置。
3. 同样认证读取`GET /api/datasets`和`GET /api/defaults`。选择新test题库，截取其sampleIds前500个，并原样使用defaults.variants。可在终端运行`node --import tsx`打开REPL，用下面的片段生成私有配置（先将baselineName改成你们实测最快的设备名）：

```js
const fs = await import('node:fs/promises');
const server = JSON.parse(await fs.readFile('config/local-server.json','utf8'));
const coordinatorUrl = 'http://127.0.0.1:' + server.port;
const get = async path => {
  const r = await fetch(coordinatorUrl + path,{headers:{authorization:'Bearer ' + server.joinCode}});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};
const workers = await get('/api/workers');
console.table(workers.map(w => ({id:w.id,name:w.name,state:w.state,level:w.level})));
const baselineName = '替换成实测最快的设备名';
const baseline = workers.filter(w => w.name === baselineName);
if (baseline.length !== 1 || workers.length < 2) throw new Error('需要唯一的基线设备和至少两台已连接电脑');
const datasets = await get('/api/datasets');
const dataset = datasets.find(d => d.name === 'ARC-Challenge · 1,172 test questions');
if (!dataset) throw new Error('请先更新并重启协调端');
const defaults = await get('/api/defaults');
await fs.writeFile('config/local-benchmark.json', JSON.stringify({
  coordinatorUrl,joinCode:server.joinCode,datasetId:dataset.id,
  sampleIds:dataset.sampleIds.slice(0,500),variants:defaults.variants,
  singleWorkerId:baseline[0].id,allWorkerIds:workers.map(w => w.id),
  repeats:3,outputDir:'output/benchmarks'
},null,2),{mode:0o600});
```

运行`.exit`离开REPL，再运行：

```sh
npm run benchmark -- --config config/local-benchmark.json
```

macOS终端和Windows PowerShell均可使用Node24 REPL和同一个npm命令。若配置的是远程协调端，coordinatorUrl使用协调主机的局域网地址，读取你自己的私有配置中的加入码。不要把local-benchmark.json放进共享包，因为它包含加入码。

脚本等待每台设备新的Ready心跳后开始，模型加载时间不进入正式放行计时。不要在测试中点击Pause/Exit或改档位。结果写入`output/benchmarks/<run-id>/summary.json`及每轮JSON。根据每轮JSON里的experimentId，在评测平台顶部打开该轮即可查看并导出CSV。summary的singleToDynamic是最强单机与动态多机的中位数耗时比。

## 三分钟现场顺序

| 时间 | 屏幕和动作 | 要表达的点 |
| --- | --- | --- |
| 0:00–0:25 | 一张真实需求图/发布页：500题×3个提示词 | 学生改提示词后需要反复回归评测，闲置电脑能帮助缩短等待 |
| 0:25–1:00 | 提前测好的单机/多机对比表，链接各轮原始报告 | 相同模型、相同题目、关闭缓存；报告实测中位数和倍率 |
| 1:00–1:40 | 正在运行的独立展示轮：任务持续被多台电脑接受 | 展示真实模型输出、当前评测的贡献设备、任务分配 |
| 1:40–2:20 | 一台正在计算的设备点击Exit，观察其他节点继续 | 资源属于贡献者，允许退出；任务回收后继续完成。预留租约恢复时间 |
| 2:20–2:45 | 打开一个题目的三种提示词原始答案与评分 | 平台完成可检查的AI评测，不只是动画计数器 |
| 2:45–3:00 | 回到对比表和贡献记录 | 强调实测减少了多少等待，以及贡献者可控制参与 |

为现场准备一轮还未完成的真实任务，提前运行到一部分即可。避免在台上等待长跑结束。准备一次同流程录屏和已保存JSON/CSV作为网络故障备用，播放时明确它是此前实测记录。

贡献列表只展示本轮产生过被接受的新结果的设备；无关旧设备已排除。某设备本轮贡献过然后退出，保留记录是正确的，便于评委看到退出前的贡献。刚加入但还没交回结果的设备暂时不会出现在这张表。

目前新增功能的自动化检查不能代替多台实体电脑的性能测量。不要宣称四台一定快四倍，也不要把模型耗电或节电比例当成已测量结果；现阶段验证的是完成时间和资源可用性。

## 新增：保存加入/退出演示过程

新实验已支持自动过程录制；录制状态与Export replay JSON入口位于耗时指标下方。完整步骤、稳定设备ID和回放字段见[过程录制指南](process-recording.md)。正式演示前升级各设备Worker并重启，使同一机器重入时保留deviceId。原CSV与普通JSON仍分别负责对比摘要和原始答案。
