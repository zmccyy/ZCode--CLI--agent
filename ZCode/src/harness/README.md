# harness/

ZCode Harness —— Agent 运行时（v1.0 交付循环/六件套/权限门/护栏/转录，v1.1 增补自动上下文压缩与会话恢复）：多轮 Think→Act→Observe 工具循环、核心六件套工具（Read / Glob / Grep / Write / Edit / Bash）、权限门（Plan / Agent / YOLO）、护栏（轮数 + token 预算）、会话转录（JSONL）、长任务自动压缩、`--continue` / `--resume` 会话恢复。

- 计划：[docs/plans/harness-v1-plan.md](../../docs/plans/harness-v1-plan.md)
- 底座决策：[docs/adr/0001-progressive-port-clean-endgame.md](../../docs/adr/0001-progressive-port-clean-endgame.md)
- 术语表：[CONTEXT.md](../../CONTEXT.md)
- UC-03 验收留档：[docs/acceptance/uc03-acceptance.md](../../docs/acceptance/uc03-acceptance.md)

## 布局

| 文件 | 职责 |
|---|---|
| `loop.ts` | Agent 循环：流式收模型响应 → 权限门 → 执行工具 → 结果回灌 → 继续，直到 end_turn / 护栏触发；内嵌压缩触发与恢复播种 |
| `types.ts` | provider 无关的消息、工具、事件、结果类型 |
| `translate.ts` | 内部消息 ⇄ OpenAI 兼容 / Anthropic 两种线上方言 |
| `compact.ts` | 自动上下文压缩：上一请求 input tokens 达阈值时，用一次无工具请求把较早历史摘要化，保留最近 N 条原文 |
| `resume.ts` | 会话恢复：从转录 JSONL 重建消息历史与 Read 前置状态；`listSessions` / `findLatestSession` / `resolveSessionPath` |
| `permissions.ts` | 三档权限门；Agent 模式无审批者时 fail-closed |
| `guardrails.ts` | 两条硬停线：`maxTurns`（默认 30）与 `budgetTokens` |
| `transcript.ts` | JSONL 转录，默认落 `~/.zcode/projects/<cwd-hash>/<sessionId>.jsonl` |
| `usage.ts` | usage 累计辅助（循环与压缩共用） |
| `tools/` | 六件套实现与注册表；Edit/Write 前必须先 Read（会话级状态） |

## 压缩（compact）

- 触发：provider 上报的**上一请求 input tokens** ≥ 阈值（默认 100k；`ZCODE_COMPACT_TOKENS=0` 关闭，`ZCODE_COMPACT_KEEP_MESSAGES` 调保留条数，默认 6）。
- 边界安全：保留尾巴若落在 `tool` 消息上会回退到其 assistant 轮，绝不发送悬空 tool_result（Anthropic 会直接报错）。
- 摘要请求**不带 tools、不带 system**，模型只能回文本；usage 计入会话总账。
- 尽力而为：摘要失败或为空 → 不压缩继续跑，事件与转录如实记录（`context_compact` 条目含摘要文本，供审计）。

## 恢复（resume）

- `zcode -p "…" --continue` 续最近会话；`--resume <sessionId|path>` 指定会话；`zcode sessions` 列出本工作区会话。
- 新会话把恢复的历史原样写进自己的转录（自包含，可链式恢复），并在 session_start 记 `resumedFrom`。
- 恢复时从历史里的 Read 工具调用重建 `state.readFiles`，Edit/Write 的 read-before-edit 前置在续会话中依然成立。
- 转录逐行容错解析：损坏行跳过并计数；无消息的转录拒绝恢复。

## 约定

- **TypeScript + Node ≥ 24 原生类型剥离**，零构建步骤（`node --experimental-strip-types` 即可运行）。
- **不复制底座树代码**：`src/` 下从 Claude Code 还原的源码只作设计与行为参照（工具语义、循环形态），在本目录用干净代码重新表达。
- 工具语义以底座树同名工具为准（如 Edit = 精确字符串唯一匹配替换）。
- Provider 层复用 `src/providers/`（`tool_call` 流事件），循环与工具注册表独立实现。
- **测试**：`test/helpers/fakeLlmServer.js` 提供两种 SSE 方言的剧本式假 LLM 服务器，驱动真实循环 + 真实工具；测试位于 `test/harness/`。
