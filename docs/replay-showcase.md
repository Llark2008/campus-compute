# 真实实验动态展示页

打开 `http://localhost:3000/showcase.html`，或双击 `output/showcase/campus-compute-replay.html` 用 Chrome、Edge 或 Safari 打开。单文件 HTML 约 3.3 MB，包含真实记录、界面和字体回退，不依赖协调端、其他电脑在线或外部网络。在评测平台打开 `join_and_out`，Process recording 区域也有 Watch replay 入口。

## 操作

- Play replay：从当前时间播放；默认24×，整轮约22秒。播放到结尾自动停止，再次点击Replay从头播放。
- Pause：暂停，保留当前设备状态和计数。点击空白处后空格也可切换播放/暂停。
- 时间轴：拖动定位；聚焦后可用键盘Home/End及方向键。拖动会暂停，便于讲解。
- 1× / 3× / 6× / 12× / 24× / 48× / 96×：调整回放速度。数字、贡献和接手耗时始终使用真实实验时间。
- Start / optional joins / cindy-mac joins / Device exits / Task handed off / Complete：直接定位六个关键节点。
- Fullscreen：进入全屏。总进度条按设备颜色分段，各颜色长度表示该设备完成的任务占总任务的比例。退出设备的已完成部分仍然保留。
- Download source recording：下载与页面一致的原始过程JSON。

## 快速讲解顺序

1. 停在Start，说明本轮最终内部测试使用 **1,000个不同问题 × 每题3种提示词 = 3,000个推理任务**。每个task是一个问题与一种提示词的组合。
2. 默认24×，约22秒看完。播放约4秒时第二台加入，约10秒时第三台加入，约16秒时一台退出。进度条的绿色、蓝色和橙色分别对应三台设备。
3. 如需更快，选48×约11秒或96×约6秒。所有速度都保留相同的真实计数和事件时间。
4. 完成后展示3,000个新结果和1,769/638/593的贡献；点击Task handed off，单独解释退出时的28毫秒接手与1.016秒接受结果。这两个数字是本次任务的实际观测，不是回放速度。

## 真实数据边界

源实验：`90a8719c-4f0d-41f3-b5df-13046c68faf8` / `join_and_out`。
最终规模：**1,000个不同问题、3种提示词、3,000个任务**；完成3,000项新计算，缓存0、失败0。
时间范围：2026-09-12 11:09:30.214–11:18:23.457，America/New_York，总耗时533.243秒。
初始设备名单只取录制起点；后来注册的设备按事件时间出现。贡献来自唯一accepted任务，与每帧数据核对。退出后设备变灰而贡献保留。旧客户端会话不按名称强行合并。

界面明确标注REPLAY和倍速。连接线与笔记本图形表示任务活动，不代表测得的CPU利用率或数据包路径；计数和事件使用协调端记录。此次记录没有重启空档；有空档的记录在数据层保留断点，并在播放到空档时提示。

## 重建

`npm run build:web` 构建原有评测页面和展示页；`npm run build:showcase` 只重建展示页。

数据文件为 `data/showcase/join-and-out.json` 与 `join-and-out-timing.json`，前者与原始过程导出内容相同，后者来自普通报告的createdAt/finishedAt。构建结果同时写入 `dist/web/showcase.html` 和 `output/showcase/campus-compute-replay.html`。
