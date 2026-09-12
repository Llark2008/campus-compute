# 实验过程录制与回放 JSON

更新后的协调端会为**新发布的实验自动录制**，无需额外点击开始。录制在协调端运行，关闭浏览器也会继续。实验完成或取消时保存最后一帧并停止；旧实验没有录制数据，页面会显示No process recording，不会根据最终状态编造历史。

## 开始正式的加入/退出实验

1. 协调端使用当前新版。各机器使用更新后的客户端包并重启Worker，以获得持久的本机deviceId。配置、模型和引擎沿用已有文件；先退出当前计算再重启Worker。
2. 让第一台电脑Start并进入Ready，发布一个有足够**Fresh to run**任务的新实验。新的1,172题库适合准备长任务队列。普通评测复用已有缓存；改评测名称不会产生新计算。
3. 在实验页面确认 **Process recording → Recording automatically**，事件数和帧数持续增加。协调端每2秒保存一帧，并在任务/设备事件发生时立即记录事件。
4. 隔一段时间让第二、第三台电脑Start。让它们先有一些已接受结果，再让一台正在计算的电脑Exit。另一台继续处理队列。若想测试重入，同一台电脑再Start。
5. 完成或取消后点击 **Export replay JSON**，保存`campus-compute-replay-<experimentId>.json`。另外导出普通JSON报告保留原始模型答案；CSV用于耗时对比，不能替代过程JSON。

不要用现有九轮速度benchmark脚本做自由加入/退出演示：该脚本固定Worker会话名单，并排除中断轮次；退出后新会话不在原名单中。加入/退出演示使用有新计算任务的普通实验，正式加速表单独按benchmark流程测试。

## 设备范围与身份

过程文件记录**该实验期间同组算力池**的活动：起始在线设备、之后新加入/恢复的设备，以及它们的退出和离线。刚加入、贡献仍为0的设备也保留。实验开始前已停止或已超时的旧会话不混入起始名单。池内设备可能同时参与其他实验；文件里的贡献数、积分与activeTaskIds始终只属于当前实验。

原来的Contributing devices表仍只显示本实验接受过新结果的设备。刚加入的零贡献设备已在录制文件里，不要求先出现在这张贡献表。

每个新版Worker安装在自己的stateDir保存`device-id.json`，是随机UUID，不读取硬件序列号。相同deviceId对应同一个安装，workerId对应一次注册会话。退出再Start会产生新的workerId，但deviceId保持不变；制作按机器汇总的卡片时把同deviceId的会话贡献相加。**不要把device-id.json或整个stateDir复制到另一台电脑**。

旧客户端仍可正常计算和被录制，但缺少持久身份时，导出标记`identityKind: "session"`，其deviceId形如`session:<workerId>`。不能仅凭相同设备名称推断它们就是同一台电脑；正式重入演示前应升级客户端。

## 时间的含义

所有`at`使用协调端Unix毫秒时间；事件按`seq`排列，相同毫秒也保持顺序。每帧另有自己的`seq`和`eventCursor`，时间不是唯一主键。

- `registered`表示协调端注册成功，发生在本机模型加载/热身之后，不是按下Start的瞬间。
- `state_changed`、`level_changed`记录协调端收到的状态/档位变化；通常来自约3秒一次的心跳。短于心跳间隔且未上报的本机瞬间状态不应由回放猜测。
- `left`表示协调端收到主动退出；若退出通知没送到，会在最后心跳约20秒后观察到`offline`。`online`表示后来又收到心跳。
- `worker_observed`记录一个此前不在本次录制名单里的现有会话被重新观察到，例如超时设备在清理前恢复。
- 协调端重启会追加`recording_resumed`及`gapFrom/gapTo`，并令`recording.hasGaps=true`。空档期间没有帧，不能插值成真实测量。优雅关闭也会留下`recording_paused`与checkpoint帧。

## 文件结构（schemaVersion:1）

| 字段 | 用途 |
| --- | --- |
| `scope`, `timeUnit`, `frameIntervalMs` | 算力池活动范围、Unix毫秒、目标帧间隔2,000ms |
| `recording` | 是否有记录、起止时间、事件/帧数量、是否有观测空档 |
| `experiment` | 实验ID/名称/模式、题量、提示词数、模型与推理指纹 |
| `tasks` | 固定任务清单与不可变的`initialState`、`initialSource`、`initialResultId`；明确哪些任务发布时已命中缓存 |
| `workers` | 所有被观察过的会话及稳定设备ID、身份种类、首次观察时间、公开设备信息 |
| `events` | 未截断的完整事件流，含时间、顺序、任务/Worker及结构化数据 |
| `frames` | 起点、每2秒、重启恢复、关闭检查点和终点的进度/设备快照 |

`frames[].progress`包括planned、fresh、cached、queued、leased、failed、canceled、retries。`frames[].workers[]`包括该会话的completed、credits、state、level、lastSeenAt、activeTaskIds和deviceId。高频心跳不重复写相同状态事件。原始错误文本、访问令牌、加入码、模型本地路径不导入过程文件。

主要任务事件：`claimed`、`accepted`、`released`、`expired`、`faulted`、`task_canceled`。其data保留taskState、source、resultId、leaseId、attemptState，以及题目/提示词ID。每次重新领取有不同leaseId；同一taskId只接受一个新结果。

## 制作回放网页时

1. 初始设备取第一帧的workers；完整workers数组也包含后来加入者，不要全部提前显示。每个任务从tasks中的initialState开始，缓存不计新贡献。
2. 总任务数使用progress.planned。真实新计算的曲线使用fresh；缓存cached单列。若进度条代表终结任务，失败/取消要单独着色，不能当成成功推理。
3. 以某帧为基点时，只继续应用`event.seq > frame.eventCursor`的事件，避免把帧内已包含的accepted再加一次。按taskId去重贡献，按leaseId展示释放/重新分配。
4. 新会话在registered/worker_observed时出现为0贡献；left/offline后变灰并保留已完成数量。稳定deviceId可把同一安装重入的会话合并。
5. 回放可支持播放/暂停/拖动/倍速；明确标注回放倍率。协调端观测空档应显示断点提示，不播放假造的连贯测量。

完整过程导出接口为`GET /api/experiments/:id/trace`，需要组加入码Bearer认证；不可用的旧实验返回404。普通snapshot只携带轻量recording状态，避免轮询时重复下载整个事件流。
