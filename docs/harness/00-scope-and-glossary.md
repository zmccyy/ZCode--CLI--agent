# 00 范围与术语

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05（v1.4.0）
> Source refs: [CONTEXT.md](../../CONTEXT.md)、[README.md](./README.md)

## 产品定位

**ZCode Harness 是围绕验收条件执行、验证、恢复并审计代码任务的本地工程运行时。**

它不是“替用户写代码的聊天 Agent”：模型停止调用工具不代表任务完成；只有具备验证证据的任务才允许报告为完成（见 [02-product-principles-and-dod.md](./02-product-principles-and-dod.md)）。

## 范围（In scope）

- 多轮 Think→Act→Observe Agent 循环（`ZCode/src/harness/loop.ts`）
- 核心六件套工具：Read / Glob / Grep / Write / Edit / Bash
- 权限门：Plan / Agent / YOLO 三模式，fail-closed
- 工作区边界与 Bash 命令策略（allow/deny/ask）
- 护栏：maxTurns + budgetTokens
- 会话转录（JSONL）、自动上下文压缩（compact）、会话恢复（resume）
- 双 Provider 方言：OpenAI 兼容 + Anthropic（`ZCode/src/providers/`）
- CLI（`-p` headless + TUI）与 `--json` 机器契约

## 非目标（Non-goals，截至 v1.4）

| 非目标 | 原因 | 例外 |
|---|---|---|
| Bash 沙箱隔离 | bashPolicy 是命令分类器，不是 sandbox；真正沙箱在 P2（sandbox-runtime） | 文档必须始终诚实声明（[operations/52](./operations/52-security-threat-model.md)） |
| 远程执行 / 云端会话 | 本地运行时优先；远程属于 P2 可插拔 executor | — |
| GUI / IDE 集成 | 终端原生是产品边界 | TUI 属于本范围 |
| 无界自主反思 | 反思必须有界并产出动作（换策略/缩小问题/询问/结束） | 有界 StuckDetector 在 P1 |
| 通用 MCP 总线 | P1 只做 stdio 最小子集，默认关闭 | 见 roadmap |

## 术语

核心术语以 [CONTEXT.md](../../CONTEXT.md) 为准，此处只列 Harness 语境下的增量定义：

| 术语 | 定义 |
|---|---|
| **Loop**（工程语境） | 本文档体系的开发节奏：改 → 验证 → 修复 → 复验 → 记录 |
| **Turn** | 一次 provider 请求 + 0..n 个工具执行，`loop.ts` 的最小推进单元 |
| **Task status** | 任务级完成状态：`complete/partial/blocked/failed/aborted`（区别于 loop 的 `stopReason`） |
| **stopReason** | 循环为何停止：`end_turn/max_turns/budget_exceeded/aborted/error` |
| **Boundary** | 文件工具（Read/Glob/Grep/Write/Edit）的词法+realpath 工作区限制；**不覆盖 Bash** |
| **Bash policy** | Bash 命令的 allow/deny/ask 分类门；deny 在含 YOLO 在内的所有模式生效 |
| **Fake LLM** | 剧本式 SSE 假服务器（`test/helpers/fakeLlmServer.js`），驱动真循环+真工具做集成测试 |
| **read-before-edit** | Edit 前必须先 Read 同一文件的会话级前置条件（`state.readFiles`） |

## 版本边界

- 运行时：Node ≥ 24（原生 TS 类型剥离，零构建）；主平台 Windows + Git Bash。
- 代码边界：`ZCode/src/` 为 100% 第一方代码（ADR-0001）；唯一入口 `ZCode/src/entrypoints/publicCli.js`。
- 本文档体系覆盖 v1.4.0 基线及其后的 P0–P2 演进（见 roadmap）。

## Security notes（必须诚实声明的信任模型）

1. Boundary 只约束文件工具；**Bash 可写用户权限可达的任意路径**（`boundary.ts` 头注释）。
2. `--no-boundary` 是显式逃生选项，解除全部文件边界。
3. YOLO 自动批准全部工具调用，但 **deny 列表在 YOLO 下依然拦截**。
4. transcript 明文记录 prompt 与工具输入/输出；密钥脱敏与保留策略见 operations/52。
