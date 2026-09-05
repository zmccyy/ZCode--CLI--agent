# 13 Provider 方言层

> Status: normative · Owner: provider maintainers · Last verified: 2026-09-05（v1.4.0）
> Code refs: `ZCode/src/providers/openaiCompatible.js`、`anthropic.js`、`runtime.js`、`modelRegistry.js`、`ZCode/src/harness/translate.ts`
> Test refs: `test/openaiCompatibleProvider.test.js`、`test/anthropicProvider.test.js`、`test/anthropicStreamChat.test.js`、`test/harness/openaiProviderRetry.test.js`、`test/harness/anthropicDialect.test.js`

## 职责分界

| 层 | 职责 | 禁止 |
|---|---|---|
| provider 适配器 | SSE 解析、tool_call 增量合并为完整 ToolCall、usage/finishReason、429/5xx/网络重试、retry-after、timeout、AbortSignal、认证头 | 把原始 SSE 字段泄漏给 harness |
| translate.ts | canonical 消息 ⇄ 两种方言的请求/响应转换；连续 tool result 合并（Anthropic 角色交替） | 理解业务语义 |
| harness/loop | 只消费 canonical `ProviderStreamEvent`（`types.ts:153`） | 出现任何方言判断 |

## 流事件契约（canonical）

```text
response_start {messageId, model, provider}
text_delta     {text}
reasoning_delta {text}
tool_call      {toolCall: {id, name, input}}     ← provider 层已完成增量合并
response_end   {finishReason, usage?}
```

## 各方言行为矩阵

| 行为 | OpenAI 兼容 | Anthropic | 契约要求（P0-B 统一） |
|---|---|---|---|
| 坏 JSON SSE 事件 | 抛错（`JSON.parse` 直接 throw） | 静默跳过 | **统一为显式策略**：默认跳过并计数，连续 N 个坏事件升级为错误 |
| `response_end` 缺失（EOF） | loop 端无感知 | 同左 | loop 必须判 malformed（architecture/11） |
| `thinking_delta` | n/a | **忽略**（缺陷 E3） | 映射为 `reasoning_delta`；隐私策略：thinking 不落 transcript 明文（默认） |
| 内建重试 | 默认 2 次 | 默认 2 次 | 与 loop 重试共享预算/deadline（B4）；必须可配置可关闭 |
| retry-after | 支持 | 支持 | 解析上限（如 ≤120s），防恶意服务器 |
| 中断 | AbortSignal 贯穿 | AbortSignal 贯穿 | 请求、连接、退避三处全部可中断 |

## 错误分类（provider → loop → CLI 统一）

```text
auth_failure | rate_limited | server_error | network_error | timeout | protocol_error | user_aborted
```

- `user_aborted` 不得触发重试。
- `rate_limited`/`server_error`/`network_error` 参与重试预算。
- `protocol_error` 不重试（重放同一坏流无意义），直接归为该轮 error。
- 错误文本面向用户可读；`--json` 下使用结构化 code（contracts/23）。

## Secret 处理

- API key / Authorization / `x-api-key` / 自定义敏感头只存在于 provider 内；禁止写入 transcript、错误消息、`doctor` 输出（operations/52 的资产清单）。
- `ZCODE_OPENAI_HEADERS` 等自定义头在日志中出现时必须 redact。

## 新增 Provider 的门槛（workflows/31 摘要）

1. 通过 `providerContract.test.js` 全部用例；
2. 用 `fakeLlmServer` 对应方言剧本跑通真循环；
3. 声明 capability（streaming/toolCalling/contextWindow/maxOutputTokens/重试/取消支持）——不支持的特性必须显式声明，禁止静默假设；
4. 更新 api-reference 支持矩阵 + doctor 输出。
