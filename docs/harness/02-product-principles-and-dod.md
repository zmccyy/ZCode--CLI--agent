# 02 产品原则与完成契约（Definition of Done）

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05（v1.4.0）
> Source refs: [00-scope](./00-scope-and-glossary.md)、[architecture/12](./architecture/12-task-lifecycle-and-completion.md)、[contracts/24](./contracts/24-task-completion-contract.md)

## 第一原则

**模型停止调用工具 ≠ 任务完成。**

`stopReason: 'end_turn'` 只说明循环为何停止；任务是否完成必须由**完成契约**判定。这是 ZCode 与“能跑的 demo”之间的分界线。

## 任务完成状态（Task Status）

| 状态 | 判定条件 |
|---|---|
| `complete` | 全部验收条件有通过证据 |
| `partial` | 部分验收条件通过，其余有明确说明（不是含糊的“基本完成”） |
| `blocked` | 缺权限/凭据/环境/信息，继续猜测属于违规；必须列出解除阻塞所需的具体输入 |
| `failed` | 尝试后验收条件未达成且无阻塞项 |
| `aborted` | 用户取消或护栏终止；保留已完成工作与恢复入口 |

对应协议 schema 见 [contracts/24-task-completion-contract.md](./contracts/24-task-completion-contract.md)。`stopReason` 与 `status` 的映射：

| stopReason | 允许的 status |
|---|---|
| `end_turn` | complete / partial / blocked / failed |
| `max_turns` / `budget_exceeded` | partial / blocked |
| `aborted` | aborted（+已完成工作的 partial 说明） |
| `error` | failed / blocked |

## 完成证据（completion evidence）

报告 `complete` 前，以下证据必须存在：

1. **验收条件**：任务目标被解析为可判定的条件列表（由 Plan 阶段产出）。
2. **变更范围**：实际 diff 与目标一致；列出全部修改文件。
3. **验证记录**：至少一项与目标直接相关的验证（测试/构建/lint/类型检查/最小运行），含命令与结果。
4. **失败闭环**：验证失败后必须有修复记录或如实降级为 partial/failed/blocked。
5. **遗留清单**：已知未完成项、风险与建议下一步。

## 工程原则（所有 P0–P2 开发的 review 基线）

1. **最小修改**：只改与验收条件相关的代码；测试文件不允许被篡改以“让测试通过”。
2. **可恢复**：任何中断（取消/崩溃/护栏）后，状态可从 transcript 重建；恢复只信成功执行的事实，不信模型意图。
3. **可审计**：每次工具调用留下 permission 判定、输入摘要、结果、耗时；敏感值落盘前 redact。
4. **默认最小权限**：Plan 零写入；Agent fail-closed；YOLO 不豁免 deny 列表；`--no-boundary` 是显式行为。
5. **事实优先**：文档、CHANGELOG、`doctor` 输出不得声明未实现的能力；实现与声明漂移按缺陷处理。
6. **确定性测试**：普通测试零网络、零真实包管理器、有超时、可离线复现；真实网络测试单独 gate。
7. **失败要可见**：取消/截断/写失败不得伪装成功；`abort` 不得被报告为 `end_turn`（P0-B 契约）。
8. **契约先行**：改行为先改 contracts/ 与测试，再改实现（workflows/ 各篇的强制流程）。

## DoD：任何 Harness 能力交付的完成定义

- [ ] contracts/ 相应文档已更新（含不变量与失败语义）
- [ ] 单元 + 集成（fake LLM 驱动真循环真工具）+ 安全回归三类测试存在且通过
- [ ] `npm run typecheck`、`npm run lint`、`npm test` 全绿（operations/51 的 Gate 命令）
- [ ] 证据留档：若属用户可见能力，附最小验收记录（命令 + 输出摘要）
- [ ] 文档同步：README/api-reference/implementation-status 中对应声明已核对
- [ ] 回滚说明：该能力的开关方式或回退方式写入 roadmap 对应条目

## Failure semantics

- 无法满足 DoD 的交付只能以 `partial` 记入 roadmap，并注明缺口与下一 Loop 计划。
- 安全类 DoD（权限/边界/脱敏）不允许 partial 交付；未达标则阻断发布（operations/51）。
