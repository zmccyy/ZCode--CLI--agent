# 21 Provider 适配契约

> Status: normative · Owner: provider maintainers · Last verified: 2026-09-05（v1.4.0）
> Source of truth: `ZCode/src/harness/types.ts`（LoopProvider、ProviderStreamEvent）+ `ZCode/src/contracts/providerAdapter.js`
> Test refs: `test/providerContract.test.js`、`test/harness/openaiProviderRetry.test.js`、`test/harness/anthropicDialect.test.js`

## 最小接口（loop 视角）

```ts
LoopProvider = {
  id: string
  kind?: string                    // 'openai-compatible' | 'anthropic' …（决定方言）
  streamChat(input: Record<string, unknown>): AsyncIterable<ProviderStreamEvent>
}
```

完整公共适配器（`createProviderAdapter`）额外暴露：`provider`、`config`、`listModels()`、`getCapabilities()`、`validateConfig()`、`normalizeToolCalls()`。loop 只依赖最小接口——新增 provider 能力必须先落 capability 声明，再被 harness 消费。

## streamChat 输入约定

```text
{ messages: WireMessage[], tools?: WireTool[],
  system?: string(anthropic), model?, temperature?, maxTokens? }
```

## 流事件与实现义务

见 [architecture/13](../architecture/13-provider-dialect.md) 行为矩阵。强制义务：

1. **增量合并**：tool_call 参数流必须在 provider 层合并为完整 `{id,name,input}` 再发出；不完整的调用参数流 = `protocol_error`。
2. **usage 如实上报**：无 usage 时省略字段，禁止伪造 0。
3. **重试纪律**：内建重试只覆盖 429/5xx/网络；必须可配置（attempts、backoff、retry-after 上限）；必须接受 loop 注入的共享预算/deadline（P0-B）。
4. **取消**：AbortSignal 贯穿连接、流读取、退避等待；取消后 `user_aborted`，不重试。
5. **坏事件策略**：跳过 + 计数；连续 N（建议 10）个坏事件 → `protocol_error`。两方言一致（P0-B 统一，当前 OpenAI 抛错 / Anthropic 静默的不一致必须消除）。
6. **终止事件**：正常结束必须发 `response_end`；提前 EOF 由 loop 判 malformed——provider 不得吞掉连接中断。
7. **Secret**：认证信息只在本层；错误消息/日志/transcript 禁止携带。

## Capability 声明（P1 实装，字段在此冻结）

```ts
Capabilities = {
  streaming: boolean
  toolCalling: boolean
  supportsJsonSchema: boolean
  contextWindow: number | null
  maxOutputTokens: number | null
  builtinRetry: { attempts: number; supportsRetryAfter: boolean }
  cancellation: boolean
  usageCompleteness: 'full' | 'partial' | 'none'
  reasoning: boolean          // 是否可能产生 reasoning_delta
}
```

不支持的能力**显式声明**，harness 据此降级（如无 cancellation 的 provider 在 TUI 中提示不可中断）。

## 错误分类

`auth_failure | rate_limited | server_error | network_error | timeout | protocol_error | user_aborted`
（语义与映射见 architecture/13；`--json` 输出使用这些 code，见 contracts/23。）

## 新增 Provider DoD

1. 通过 `providerContract.test.js` + 方言剧本（fakeLlmServer）真循环；
2. capability 全量声明；
3. api-reference 支持矩阵 + doctor 输出同步；
4. live e2e 单独 gate（无 key 跳过，见 testing/40）。
