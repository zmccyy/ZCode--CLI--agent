# harness/

ZCode Harness v1 —— Agent 运行时（已随 v1.0 交付）：多轮 Think→Act→Observe 工具循环、核心六件套工具（Read / Glob / Grep / Write / Edit / Bash）、权限门（Plan / Agent / YOLO）、护栏（轮数 + token 预算）与会话转录（JSONL）。

- 计划：[docs/plans/harness-v1-plan.md](../../docs/plans/harness-v1-plan.md)
- 底座决策：[docs/adr/0001-progressive-port-clean-endgame.md](../../docs/adr/0001-progressive-port-clean-endgame.md)
- 术语表：[CONTEXT.md](../../CONTEXT.md)
- UC-03 验收留档：[docs/acceptance/uc03-acceptance.md](../../docs/acceptance/uc03-acceptance.md)

## 布局

| 文件 | 职责 |
|---|---|
| `loop.ts` | Agent 循环：流式收模型响应 → 权限门 → 执行工具 → 结果回灌 → 继续，直到 end_turn / 护栏触发 |
| `types.ts` | provider 无关的消息、工具、事件、结果类型 |
| `translate.ts` | 内部消息 ⇄ OpenAI 兼容 / Anthropic 两种线上方言 |
| `permissions.ts` | 三档权限门；Agent 模式无审批者时 fail-closed |
| `guardrails.ts` | 两条硬停线：`maxTurns`（默认 30）与 `budgetTokens` |
| `transcript.ts` | JSONL 转录，默认落 `~/.zcode/projects/<cwd-hash>/<sessionId>.jsonl` |
| `tools/` | 六件套实现与注册表；Edit/Write 前必须先 Read（会话级状态） |

## 约定

- **TypeScript + Node ≥ 24 原生类型剥离**，零构建步骤（`node --experimental-strip-types` 即可运行）。
- **不复制底座树代码**：`src/` 下从 Claude Code 还原的源码只作设计与行为参照（工具语义、循环形态），在本目录用干净代码重新表达。
- 工具语义以底座树同名工具为准（如 Edit = 精确字符串唯一匹配替换）。
- Provider 层复用 `src/providers/`（`tool_call` 流事件），循环与工具注册表独立实现。
- **测试**：`test/helpers/fakeLlmServer.js` 提供两种 SSE 方言的剧本式假 LLM 服务器，驱动真实循环 + 真实工具；测试位于 `test/harness/`。
