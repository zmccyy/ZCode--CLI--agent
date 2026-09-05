# 41 假 LLM 与测试夹具

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05
> Source of truth: `ZCode/test/helpers/fakeLlmServer.js`；消费方：`test/harness/*`

## 定位

`fakeLlmServer.js` 是**剧本式 SSE 假服务器**，支持 OpenAI 兼容与 Anthropic 两种方言。它驱动**真循环 + 真 provider + 真工具**——不 mock loop、不 mock 工具。这是本项目集成测试的基石。

## 剧本格式（以现有测试为准）

每个剧本 = 每轮 HTTP 请求对应的 SSE 事件序列：

```js
// 例（见 loop.test.js / m2Security.test.js 实际写法）
[
  [ // 第 1 轮：模型请求 Grep
    { type: 'response_start', … },
    { type: 'tool_call', toolCall: { id: 't1', name: 'Grep', input: {…} } },
    { type: 'response_end', finishReason: 'tool_call', usage: {…} },
  ],
  [ // 第 2 轮：文本收尾
    { type: 'text_delta', text: 'done' },
    { type: 'response_end', finishReason: 'stop', usage: {…} },
  ],
]
```

断言原则：对真实 `AgentLoopResult` 断言（messages 形态、toolCalls 序列、stopReason、usage、compactions），**禁止**只对调用计数断言。

## 错误/异常注入（P0-B 起必须支持）

| 注入 | 用途 |
|---|---|
| 429 / 503 / 网络断开 + retry-after | 重试语义 |
| 响应头后 EOF（无 response_end） | 协议完整性 |
| 非法 JSON 事件行 | malformed 策略 |
| 事件间任意时点挂起 + 恢复 / 不恢复 | abort 矩阵 |
| tool_call 参数流截断 | 不完整调用拒绝 |

## 资源纪律（normative）

1. **零网络**：普通测试禁止任何真实外联；端口绑定 127.0.0.1。
2. **零真实包管理器**：不允许测试执行 `npm install` 等（教训：bashPolicy 集成用例真实 install 曾致 316s 抖动失败，P0-A 注入化）。
3. **超时**：每个测试显式超时；套件整体有上限。
4. **清理**：server/子进程/临时目录在 finally 中关闭；测试结束无残留监听。
5. **隔离**：临时目录 per-test（`mkdtemp`），不共享固定路径；不污染用户 `~/.zcode`（transcript 用 `dir` 选项指到临时目录或 enabled:false）。
6. **确定性**：不依赖执行顺序、并发数、时区、locale。

## 新增夹具流程

1. 复用 fakeLlmServer，不新造 HTTP 层（除非测试 provider 传输本身）。
2. 剧本放测试文件内，与断言同处——不建全局剧本库（避免隐式耦合）。
3. 需要“故障初态”的工作区夹具（如 UC-03 的失败测试目录）→ 遵守 testing/43。
