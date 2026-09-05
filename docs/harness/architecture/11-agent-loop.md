# 11 Agent 循环：状态机与不变量

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05（v1.4.0）
> Code refs: `ZCode/src/harness/loop.ts`（主循环 240-473、consumeTurn 499-566、executeToolCall 568-678）
> Test refs: `test/harness/loop.test.js`、`m2Security.test.js`、`anthropicDialect.test.js`

## 循环状态机（以当前实现为基线）

```text
INIT ──► SESSION_STARTED（transcript: session_start；resume 则回放历史+播种 readFiles）
  └─► GUARDRAIL_CHECK（maxTurns / budgetTokens，guardrails.ts）
       ├─ 触发 → TERMINAL(stopReason=max_turns|budget_exceeded)
       └─ 通过 ─► OPTIONAL_COMPACT（上一请求 inputTokens ≥ 阈值；尽力而为，失败继续）
             └─► PROVIDER_ATTEMPT（translateRequest → streamChat；pre-output 失败退避重试，默认 3 次）
                  ├─ 已流 delta 后失败 → TERMINAL(error)
                  ├─ abort → TERMINAL(aborted)
                  └─ 流结束 ─► ASSISTANT_ASSEMBLED（追加 assistant 消息 + usage 记录）
                       ├─ 无 toolCalls ─► END_TURN ─► TERMINAL(end_turn)
                       └─ 有 toolCalls ─► TOOL_DISPATCH（逐个：权限门 → 执行 → tool 消息回灌）
                            └─► GUARDRAIL_CHECK（下一轮）
```

## 不变量（review 与测试的硬约束）

1. **配对完整**：每个 assistant tool call 必须恰好对应一条 tool 消息——未知工具、权限拒绝、执行异常都生成 model-visible 的错误结果（`executeToolCall` 保证）。
2. **ID 一致**：`toolCallId` 在 assistant 调用与 tool 结果间一致；缺失时由 `toolCallIdFor` 合成。
3. **不重放**：本轮已产出任何 text/reasoning delta 后，provider 请求失败不得重试该轮。
4. **usage 完整**：会话 usage 包含主请求与压缩请求；压缩失败不影响主循环。
5. **观察者隔离**：`onEvent` 抛异常不影响循环。
6. **abort 语义**（P0-B 收紧）：abort 后 `stopReason` 必须为 `aborted`；**禁止**把中断/截断的流当作空文本 `end_turn`。

## Turn 生命周期（P0-B 目标契约，roadmap Loop 3）

当前缺陷 B1：`consumeTurn` 在 `signal.aborted` 时仅 break，provider EOF 无 `response_end` 时仍返回 outcome，外层可能误判为 `end_turn`。目标契约：

```text
turn lifecycle: started → streaming → completed | aborted | malformed | failed
- completed 的必要条件：收到 response_end（含 finishReason）
- EOF 无 response_end            → malformed（协议错误，该轮不产 assistant 消息 → error）
- signal 中断（任意时点）          → aborted；已收 delta 保留但 outcome 标记 aborted
- tool call 参数流不完整           → malformed，禁止执行半截调用
- loop 在 consumeTurn 返回后、每个工具执行前后复查 signal
```

测试锁定：abort 注入矩阵见 [testing/40](../testing/40-test-matrix.md) §abort。

## 重试与取消的所有权（P0-B 统一）

| 责任 | Owner |
|---|---|
| HTTP 层重试（429/5xx/网络） | provider 适配器（现状默认内建） |
| turn 级重试（未产 delta 的失败） | loop（默认 3 次尝试，指数退避封顶 8s） |
| **统一预算**（P0-B 新增） | loop 注入 `deadlineMs` 与 `attemptBudget`，provider 与 loop 共享；退避等待必须 signal-aware |
| 取消信号 | 调用方注入的 AbortSignal；贯穿 provider 请求、退避、工具执行、审批等待 |

## 失败语义汇总

| 场景 | stopReason | transcript 记录 |
|---|---|---|
| 模型自然结束 | `end_turn` | turn_end + result |
| 轮数/预算护栏 | `max_turns`/`budget_exceeded` | guardrail 条目 |
| 用户取消 | `aborted` | result（保留已完成消息） |
| 协议不完整/已流后失败 | `error` | error 条目（含分类） |
| 未流 delta 前失败且重试耗尽 | `error` | provider_retry ×n + error |
