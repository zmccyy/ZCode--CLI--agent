# 44 Benchmark 与指标

> Status: guide（P1 实装 runner；门槛自 P0 起生效） · Owner: harness maintainers

## 场景集（确定性 fake provider 驱动，禁真实网络）

| # | 场景 | 指标 |
|---|---|---|
| 1 | CLI 冷启动（doctor / models / --help） | 启动耗时 p50/p95 |
| 2 | 单轮文本 -p | TTFT、turn 延迟、tokens |
| 3 | UC-03 六轮剧本 | 总耗时、工具延迟、tokens、retry 数 |
| 4 | 100/200 轮护栏剧本 | 累计耗时、内存 |
| 5 | 10MB 工具输出回灌 | 截断行为、耗时 |
| 6 | 429/503/网络重试注入 | 恢复成功率、重试次数、退避总时长 |
| 7 | malformed/截断 SSE | 分类正确率（不得误判 end_turn） |
| 8 | abort 矩阵（连接/流/退避/工具中） | **abort→返回耗时（门：≤2s）**、残留进程数（门：0） |
| 9 | 10k 文件 + 1k symlink 树遍历 | 耗时、RSS、上限触发正确性 |
| 10 | 并发 transcript append（1/10/100 并发） | 每行可解析率（门：100%）、顺序稳定 |
| 11 | （P1）MCP discovery/call/重连 | warm call p95 ≤ 直接工具 1.25× |
| 12 | （P2）workflow checkpoint/恢复/并行 | 恢复率 ≥99%、重复副作用 0、并行加速 ≥1.5× |

## 指标定义

- **TTFT**：请求发出 → 首个 text/reasoning delta。
- **abort 响应**：signal 触发 → `loop_end` 事件。
- **恢复成功率**：注入 N 次故障后任务仍达成判定条件的比例。
- **重复副作用**：同一文件同一修改被应用 ≥2 次（重放/重试缺陷的信号，门：0）。

## P0 门槛（发布 Gate 引用）

| 指标 | 门槛 |
|---|---|
| 测试套件 | <60s（当前实测 28.6s；历史抖动 316s 不可再现） |
| UC-03 剧本 p95 总耗时 | ≤ 基线 ×1.10 |
| TTFT p95 | ≤ 基线 ×1.10 |
| abort 响应 | ≤2s，stopReason 非 `end_turn` |
| 残留（server/子进程/FD） | 0 |
| 越界（boundary/traversal/symlink） | 0 |
| transcript | 每完整行可解析；敏感值 0 落盘 |

## 执行方式（P1 实装时固化）

独立 runner（`test/benchmark/`，不进普通 `npm test`）；JSON 结果落档 `docs/harness/benchmark-results/`；release candidate 跑全套，日常跑 #1-#3 冒烟。
