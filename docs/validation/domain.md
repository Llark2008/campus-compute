# C2 题库、模板、评分与计算身份验收记录

日期：2026-09-11（America/New_York）

## 交付文件

- `src/domain/dataset.ts`
- `src/domain/prompts.ts`
- `src/domain/score.ts`
- `src/domain/keys.ts`
- `scripts/prepare-arc.ts`
- `tests/core/evaluation.test.ts`
- `tests/core/data.test.ts`
- `data/arc-demo.jsonl`
- `data/arc-examples.json`
- `data/arc-source.snapshot.json`
- `data/dataset.lock.json`

没有修改 package、shared、server、worker 或 web 文件。

## TDD 与自动化证据

首次执行：

```text
node_modules/node/bin/node node_modules/vitest/vitest.mjs run tests/core/evaluation.test.ts tests/core/data.test.ts
Test Files  2 failed (2)
Tests       no tests
原因：src/domain/dataset.ts 等待实现模块不存在。
```

领域模块实现后、生成数据前再次执行：

```text
Test Files  1 failed | 1 passed (2)
Tests       2 failed | 8 passed (10)
原因：evaluation 的 8 项行为测试通过；两个 data 测试因 ARC 文件尚未生成而以 ENOENT 失败。
```

生成真实数据后的领域测试命令：

```text
node_modules/node/bin/node node_modules/vitest/vitest.mjs run tests/core/evaluation.test.ts tests/core/data.test.ts
Test Files  2 passed (2)
Tests       10 passed (10)
```

领域范围 TypeScript 检查命令：

```text
node_modules/node/bin/node node_modules/typescript/bin/tsc --noEmit --target ES2023 --module ESNext --moduleResolution Bundler --strict --allowImportingTsExtensions --esModuleInterop --types node,vite/client src/domain/dataset.ts src/domain/keys.ts src/domain/prompts.ts src/domain/score.ts scripts/prepare-arc.ts tests/core/evaluation.test.ts tests/core/data.test.ts
退出状态：0
```

测试覆盖数字标签到 A–H 的映射、JSONL 原始行号、重复 ID／标签、空题库、严格末行答案解析、答案正确与格式合格的独立评分、默认模板必须恰有两道示例、当前题 gold answer 不进入消息或 `workKey`、提示词／题目／推理配置改变会改变计算身份，以及有限 JSON 的规范序列化。

## ARC 数据证据

准备命令：

```text
node_modules/node/bin/node --import tsx scripts/prepare-arc.ts
{"validation":299,"selected":200,"examples":["Mercury_SC_415702","MCAS_2009_5_6516"],"revision":"viewer-snapshot:025fd851d163deb4af842a9851ce5f914bdf0809bbf6a0af45d5a983bab65084","reusedSelection":false}
```

脚本从 Hugging Face 官方 dataset-viewer rows API 分页读取 `allenai/ai2_arc` / `ARC-Challenge`。每页至多 100 行，并拒绝含 `truncated_cells` 的响应。清单记录全部请求 URL、下载时间、CC BY-SA 4.0、299 条 validation 数量、固定示例 ID、种子 42、`sha256-rank-v1` 算法和 200 个最终 ID。

第二次运行输出 `reusedSelection:true`，证明脚本读取清单中的 200 个 ID，没有重新抽样。两次运行前后以下三个内容文件哈希相同：

| 文件 | SHA-256 |
|---|---|
| `data/arc-demo.jsonl` | `6a86d0dd25163f080279e89fc6ce5654ce0dc2790408fc51cee5a7c2cf9ac5cc` |
| `data/arc-examples.json` | `42df7940939b0454f6c9bed73670bbb458a15644e948602a227dd4943d04ace3` |
| `data/arc-source.snapshot.json` | `53c15c12e3b4ea897caedd212564787d78f00b2c660ddb23c58ec193f14905fe` |

实际数字标签样本 `NYSEDREGENTS_2014_8_20` 的原始标签为 `1,2,3,4`、原始答案为 `2`；导入后标签为 `A,B,C,D`、答案为 `B`，并保留 `originalLabels`。

## 剩余限制

- `revision` 是下载内容的 `viewer-snapshot` 哈希，不声称是未经验证的 Git revision。将来官方快照改变时，固定哈希测试会要求人工核对后再接受新数据。
- 官方样本 `NYSEDREGENTS_2014_8_20` 的正文含一个源数据中的 U+0002 控制字符；快照和演示题库按来源原样保留，没有静默清洗。
- 本工作单元不下载模型，也不证明真实推理结果或跨硬件一致性；这些属于后续真机验收。
- 全仓库 core 测试和全量 typecheck 依赖并行开发中的 server、worker、web 模块；本记录只把 C2 自有测试和领域范围 typecheck 作为完成证据。
