# Campus Compute — 运行手册

开发由 Codex 实现。队员负责让自己的电脑上线、决定贡献档位及比赛操作。实际验证状态见 [验收记录](validation/acceptance.md)，不要把协议测试当成 Windows 或多机实测。

## 1. 安装

使用 Node.js **24.21.0**，项目根目录执行：

```sh
npm ci
npm run build:web
npm test
```

项目附带固定版本开发用 Node 二进制依赖；本机 shell 仍使用其他 Node 时，可以通过 `node_modules/node/bin/node` 运行 TypeScript 工具。日常使用仍建议在系统选择 `.nvmrc` 对应版本。Windows 使用已安装的 Node 24，所有脚本通过 npm 运行。

准备 [llama.cpp b10917 官方完整发行包](https://github.com/ggml-org/llama.cpp/releases/tag/b10917)。Mac 选 arm64 Metal 包；Windows 按硬件选 x64 CPU 或 CUDA 包。保留二进制旁边的 DLL / dylib。首版一次只启动一个 Worker 和一个引擎。

下载 [Qwen 官方 Q4_K_M 权重](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf)，固定 revision `91cad51170dc346986eccefdc2dd33a9da36ead9`。权重约1.12GB，运行内存另计。权重和运行数据库应放在未同步的本机目录，如 macOS `~/Library/Application Support/CampusCompute` 或 Windows `%LOCALAPPDATA%\CampusCompute`，不要放入 Synology/Dropbox/OneDrive 目录。

数据已附在 `data/`；重建命令为 `npm run prepare:arc`。此命令从官方来源下载并复用固定 ID 清单。来源、许可、SHA-256 和抽样方法见 `data/dataset.lock.json`。源数据属于 CC BY-SA 4.0，应用代码与源数据许可应分开处理。

## 2. 引擎探针与公共清单

建立忽略提交的 `config/local-probe.json`，所有文件路径换成实际绝对路径：

```json
{
  "name": "my-mac",
  "modelRepo": "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
  "modelRevision": "91cad51170dc346986eccefdc2dd33a9da36ead9",
  "backend": "metal",
  "engineBin": "/local/llama-b10917/llama-server",
  "enginePrefix": [],
  "modelPath": "/local/models/qwen2.5-1.5b-instruct-q4_k_m.gguf",
  "enginePort": 8081,
  "stateDir": "/local/campus-worker"
}
```

Windows CPU 改 `backend` 为 `cpu`，路径如 `C:\\CampusCompute\\llama-server.exe`；确认 NVIDIA/CUDA 构建能运行后才使用 `cuda`。不要只改标签冒充实际后端。

```sh
npm run probe -- --config config/local-probe.json --lock config/runtime.lock.json --output docs/validation/probe-my-device.json
```

探针预热后执行20道真实 ARC 题，生成真实权重/二进制/聊天模板哈希与运行证据。第一台产生公共清单，后续设备必须保持相同语义指纹并添加自己的二进制 artifact。合并后的公共 `runtime.lock.json` 分发给所有机器。哈希不一致不得直接手改绕过校验。

## 3. 协调服务

建立 `config/local-server.json`：

```json
{
  "host": "127.0.0.1",
  "port": 3000,
  "dataDir": "/local/campus-coordinator",
  "joinCode": "replace-with-your-private-group-code",
  "runtimeLockPath": "config/runtime.lock.json",
  "datasetPath": "data/arc-demo.jsonl",
  "examplesPath": "data/arc-examples.json",
  "datasetManifestPath": "data/dataset.lock.json"
}
```

`dataDir` 必须是项目目录外的绝对路径。开发在 loopback 验证；现场需要局域网连接时，将 `host` 改为 `0.0.0.0`，客户端连接这台电脑的实际局域网 IP，确认防火墙允许所选端口。仅向受信任队员提供加入码，不对公网开放。

```sh
npm run server -- --config config/local-server.json
```

打开 `http://127.0.0.1:3000`，输入配置里的加入码，发布评测。所有运行数据保留在 SQLite；重启服务不会清空队列。`Ctrl+C` 正常关闭。

## 4. 贡献客户端

建立 `config/local-worker.json`：

```json
{
  "coordinatorUrl": "http://127.0.0.1:3000",
  "joinCode": "same-private-group-code",
  "name": "my-mac",
  "backend": "metal",
  "engineBin": "/local/llama-b10917/llama-server",
  "enginePrefix": [],
  "modelPath": "/local/models/qwen2.5-1.5b-instruct-q4_k_m.gguf",
  "enginePort": 8081,
  "controlPort": 3001,
  "stateDir": "/local/campus-worker"
}
```

```sh
sh scripts/start-worker.sh config/local-worker.json
```

```powershell
.\scripts\start-worker.ps1 -Config "C:\CampusCompute\worker-config.json"
```

或者 `npm run worker -- --config config/local-worker.json`。打开本机 `http://127.0.0.1:3001`，选择档位，点击开始。首次哈希、加载、预热完成后才注册并领任务。

- 低档：确认结果后休息本题推理时间的2倍。
- 中档：休息相同时间。
- 高档：没有主动休息。
- 暂停：完成当前题后停止接单，模型留在内存。
- 立即退出：停止本客户端拥有的引擎进程，释放任务并离网。只有进程确实退出才显示 stopped。

这些档位不是精确 CPU/GPU 百分比。关闭网页不会自动停止 Worker；使用“Exit now”或终端 `Ctrl+C`。本机控制页只允许 loopback 和机主操作，中央网页不能控制别人档位。

## 5. 发布与报告

默认200题×3提示词=600次独立生成，可先选20题排查。预览显示需要新计算和可复用量；编辑输入后重新预览。自定义 JSONL 每行示例：

```json
{"id":"liquid-1","question":"Which is liquid?","choices":[{"label":"1","text":"Ice"},{"label":"2","text":"Water"}],"answerKey":"2"}
```

题目和提示词会发到参与设备，标准答案留在协调端评分。评分结果与输出格式分别统计。模板比较只用所有模板共同已完成题目，不用难度不同的部分样本推断胜负。下载 JSON 后可查看每题原始输出和尝试记录。

相同计算正常复用缓存；改标准答案可以用相同回答重新评分。缓存、benchmark 不增加积分，错误答案也是已完成的真实计算。

## 6. 基准

使用**专用协调数据库**和已经加载模型的至少两台真实电脑。先分别测单节点，选最强者作为基线；固定每台档位、前台负载、供电和网络。填写 `config/local-benchmark.json`，包含 coordinatorUrl、joinCode、datasetId、sampleIds、variants（与发布 API 一致）、singleWorkerId、allWorkerIds、repeats:3、outputDir。

```sh
npm run benchmark -- --config config/local-benchmark.json
```

脚本有限执行九轮：单机、动态多机、静态多机，各三次并交替顺序。任务在协调端统一放行；结果缓存读写和积分关闭。错误、重试或档位变化的轮次保留原始报告并排除速度比较。不得把同一物理机的多个 Worker 作为多设备证据。单并发结论不能推广为优于经过批处理优化的高配 GPU。

## 7. 故障排查

| 现象 | 检查与恢复 |
|---|---|
| 3001白屏且JS/CSS为404 | 更新到修复版并重启本机Worker，再刷新页面；旧版启动时固定登记资源文件名，网页重新构建后会失效 |
| 端口占用 | 停止自己启动的旧进程或更换本机配置端口；不要结束其他人的模型进程 |
| 引擎无法运行/DLL缺失 | 解压完整的匹配系统发行包，先执行 `llama-server --version` |
| 模型/引擎指纹不同 | 核对版本、权重及公共 artifact，再运行探针；不要修改伪造哈希 |
| 节点不能接入 | 从节点检查协调地址、端口、加入码和防火墙；先确认 HTTP 可达 |
| INPUT_TOO_LONG | 精简题目/例题/提示词；系统不会悄悄截断 |
| 断线/租约失效 | 已失效结果不能结算，队列约20秒后回收；网络恢复后客户端重新领取 |
| 退出失败 | 本机页面保留错误；检查该客户端记录的进程 PID，不按进程名全局杀进程 |
| 运行清单不存在 | 先完成真实探针，协调服务不会自动生成假模型配置 |

## 8. 当前这台 Mac 的已配置环境

本地配置和固定模型已经准备好。运行文件持久保存在 `~/Library/Application Support/CampusCompute`，项目里的 `config/local-server.json`、`config/local-worker.json` 和 `config/local-probe.json` 已指向实际位置。加入码仅在这些私有配置中，不写入公开报告。

以后从项目根目录打开两个终端分别运行：

```sh
npm run server -- --config config/local-server.json
```

```sh
npm run worker -- --config config/local-worker.json
```

协调网页为 `http://127.0.0.1:3000`，本机贡献页为 `http://127.0.0.1:3001`。当前完整评测 ID 为 `87fab42f-96cc-4cdc-99b3-560564030ded`，可在页面顶部按 ID 打开。现有私有配置只适用于本机；队友需要使用自己的路径，并将协调地址换为主机的局域网地址。

## 9. 扩展题库、耗时与对比表

重启更新后的协调端并刷新评测页，选择ARC-Challenge · 1,172 test questions，可用20/200/500/1000/全部或自定义整数。完整题库×3提示词为3,516项任务。原200题仍保留；自定义导入上限2,000题/2MB。

总耗时从发布计起，计算耗时从首次任务派发计起，终止后均固定。View answers → Export comparison CSV导出用于拉表的秒数、题量、贡献设备数、缓存和失败数以及工作量/模型指纹。当前贡献设备只含本轮接受过新结果的设备，退出后保留本轮贡献。

正式速度比较请按[测试和三分钟展示指南](judge-testing-guide.md)使用benchmark模式关闭缓存。
