# Harness v1 计划 —— 真正完整的 Agent 运行时

> 2026-08-30 盘问会话（grill-with-docs）收敛产物。术语见 [CONTEXT.md](../../CONTEXT.md)，底座决策见 [ADR-0001](../adr/0001-progressive-port-clean-endgame.md)。

## 目标定义

**Harness = Agent 运行时**：多轮 Think→Act→Observe 工具循环 + 核心六件套工具 + 权限门 + 会话转录。headless（Print 模式）优先，TUI 后置，评测框架不在范围内。

## v1 验收（完成定义）

UC-03：`zcode -p "修复所有失败的测试" --yolo` 在**无人工干预**下走完 Grep → Read → Bash → Edit → Bash 循环，直到测试通过并如实汇报。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 定义 | Agent 运行时 harness；不含 TUI、不含评测框架 |
| 代码底座 | 渐进搬运、终局干净（ADR-0001）：照底座树设计干净重写，底座树只作参照，终局移除 |
| 新代码位置 | `ZCode/src/harness/`，TypeScript，Node ≥ 24 原生类型剥离，**零构建步骤** |
| Provider | 双线：OpenAI 兼容（DeepSeek 主力）+ Anthropic 第一方；**v1 验收只跑 DeepSeek 剧本**，Anthropic 方言剧本紧随其后（同一发布周期） |
| 权限 | Plan（只读）/ Agent（逐项 y/n）/ YOLO（全自动）三模式；护栏：默认最大 30 轮 + 可配置预算上限 |
| Shell | v1 仅 Git Bash（`bash -c`）；PowerShell 后置 |
| 输出 | 默认渲染进度行（人看）；`--json` 信封向后兼容扩展 `toolCalls[]` / `usage` / `stopReason` |
| 测试 | provider 无关的假 LLM 服务器（SSE 剧本）驱动**真实循环 + 真实工具**；live e2e 无 key 自动跳过 |
| v1 不做 | 自动上下文压缩、会话恢复、子 Agent、MCP、LSP 诊断、TUI、沙箱隔离 |
| 文档 | README 诚信补丁立即做；v1 发布时全面重写 |

## 事实基础（2026-08-30 核查）

- **公共 provider 层已支持工具调用流**：OpenAI 兼容侧解析 `tool_calls` delta（`src/providers/openaiCompatible.js:402`），Anthropic 侧解析 `tool_use` 块（`src/providers/anthropic.js:367`），统一输出 `{type:'tool_call'}` 事件 → Harness 只缺循环、工具注册表、权限门、转录四件事。
- **底座树在 Bun 下存活**：`cli.tsx --version / --help / --bare -p` 均走到正常解析；缺失目录（daemon 等）只影响 bridge/remote 惰性路径。可作行为参照系（用真实 key 对比其 `-p` 模式行为）。
- **`src/query.ts`（1729 行）与 SDK / analytics / autoCompact 等 40+ 模块纠缠** → 当蓝图读，不当零件搬。
- 运行环境：Bun 1.3.14 · Node v24.14.0。
- ~~⚠️ 当前 `.env` 的 DeepSeek API key 已失效（401），M3 验收前需更换。~~ 2026-08-31 已更换新 key 并完成 UC-03 真实验收。

## 里程碑（2–4 周/个）

| 里程碑 | 内容 | 完成标志 |
|---|---|---|
| **M0** ✅ | README 诚信补丁、本计划文档、`src/harness/` 脚手架 | 文档落盘 |
| **M1 循环骨架** ✅ | provider 无关的 Agent 循环 + 只读三件套（Read/Glob/Grep）+ Plan 模式 + 假 LLM 服务器读侧剧本测试 | 假服务器上跑通多轮读侧剧本（`test/harness/` 全绿） |
| **M2 写入与安全** ✅ | Write/Edit/Bash(Git Bash) + 权限门三模式 + 轮数/预算护栏 + 转录 JSONL | 写侧剧本全绿，护栏触发可测（`test/harness/m2Security.test.js`） |
| **M3 验收** ✅ | UC-03 在 DeepSeek 上无人工干预通过；live e2e；`--json` 信封定稿 | 验收命令真实通过并留档（[acceptance](../acceptance/uc03-acceptance.md)，2026-08-31） |
| **M4 发布** ✅ | Anthropic 方言剧本 + README 全面重写 + demo 脚本更新 + Release | v1.0 标签 |

## 工程约定

- 每个里程碑收尾：`bun test`（或 `npm test`）全绿 + `npx tsc --noEmit` 通过。
- 工具语义以底座树同名工具为参照（如 Edit = 精确字符串唯一匹配替换）。
- 转录默认落 `~/.zcode/projects/<cwd-hash>/<sessionId>.jsonl`（底座树验证过的形态，可在实现时调整）。
- 底座树代码一律不复制进 `src/harness/`——只参照设计，重新表达。
