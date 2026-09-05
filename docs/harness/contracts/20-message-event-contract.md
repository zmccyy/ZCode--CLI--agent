# 20 消息与事件契约

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05（v1.4.0）
> Source of truth: `ZCode/src/harness/types.ts`（本文档是它的权威注释；类型以代码为准）
> Test refs: `test/harness/translate.test.js`、`loop.test.js`

## Canonical 消息（内部唯一形态，非任何 wire format）

```ts
ChatMessage =
  | { role: 'user';      content: string }
  | { role: 'assistant'; text: string | null; toolCalls: ToolCall[] }
  | { role: 'tool';      toolCallId: ToolCallId; toolName: string;
        content: string; isError?: boolean }

ToolCall = { id: ToolCallId | null; name: string; input: unknown }
ToolResult = { content: string; isError?: boolean }
```

不变量：
1. `assistant.toolCalls` 与后续 `tool` 消息按 `toolCallId` 严格配对（无孤儿、无重复）。
2. `text: null` 与 `text: ''` 语义相同（无文本）。
3. `isError: true` 的 tool 消息是**正常业务流**（模型可恢复），不是循环错误。
4. `input` 为 unknown：类型安全边界在工具内部与 registry 校验（contracts/22）。

## 循环事件（LoopEvent，`onEvent` 观察者与 CLI 渲染的消费面）

```text
session_start {sessionId, cwd, model, permissionMode}
turn_start {turn}
text_delta / reasoning_delta {text}
assistant_message {text, toolCalls}
permission_request / permission_denied {toolCallId, name, input[, reason]}
tool_execution_start {toolCallId, name, input}
tool_execution_end {toolCallId, name, isError, durationMs, preview}
turn_end {turn, usage}
context_compact {ok, summarizedMessages, keptMessages, message}
provider_retry {attempt, message}
loop_end {stopReason, turns, usage}
```

P1 预留字段（向后兼容扩展）：`sessionId`、`turn`、单调 `seq`、ISO `timestamp`、`providerRequestId`、`errorCode`。事件可按 (session, turn, toolCallId, seq) 完整重放与审计（operations/53）。

## 结果（AgentLoopResult）

```ts
{ sessionId, stopReason, text, messages, toolCalls: ExecutedToolCall[],
  usage, turns, compactions, finishReason, error }
```

| 字段 | 语义 |
|---|---|
| `stopReason` | `end_turn / max_turns / budget_exceeded / aborted / error`（P0-B：abort/截断不得落 `end_turn`） |
| `text` | 最终助手文本；护栏/错误终止时为空 |
| `toolCalls` | 全部执行过的调用（含失败与被拒） |
| `usage` | 主请求 + 压缩请求累计 |
| `compactions` | 成功压缩次数 |
| `error` | 错误消息；P0-B 起附分类 code（architecture/13 错误分类） |

P1 预留：`warnings[]`（transcript 写失败等非致命问题）、`status`（contracts/24 任务完成状态）。

## 兼容策略

- 新增字段一律可选、向后兼容；删除/改名一个已发布字段需 major 版本 + api-reference 同步。
- `--json` 信封（contracts/23）是本契约的用户投影，两者禁止不一致。
