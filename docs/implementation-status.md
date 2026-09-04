# 实现状态

> ZCode CLI Agent 的**真实**实现状态：公共层（产品运行时）各模块现状、验证方式与后续计划。
> 本页以 harness 为主线；历史版本脉络见 [CHANGELOG](../ZCode/CHANGELOG.md)。

[← 返回文档中心](README.md)

---

## 1 一句话定位

`zcode -p "<task>"` 驱动一个**终端原生的 headless 编码 Agent**：多轮 Think→Act→Observe 循环 + 核心六件套工具 + 三档权限门 + 护栏 + JSONL 会话转录 + 自动上下文压缩 + 会话恢复。产品运行时由**公共层**（约 5,000 行，见下表）构成；仓库已在 v1.4 整体移出参考树，现为 100% 第一方代码（[ADR-0001](adr/0001-progressive-port-clean-endgame.md)）。

## 2 公共层模块状态（v1.4.0）

| 模块 | 路径 | 状态 | 说明 |
|------|------|------|------|
| Agent 循环 | `ZCode/src/harness/loop.ts` | ✅ | Think→Act→Observe；AbortSignal；观察者异常隔离；provider 请求失败自动重试（默认 3 次尝试，指数退避；已流式输出的轮次不重放） |
| 核心六件套 | `ZCode/src/harness/tools/` | ✅ | Read / Glob / Grep / Write / Edit / Bash 全部真实实现；Edit/Write 强制 read-before-edit |
| 消息翻译 | `ZCode/src/harness/translate.ts` | ✅ | 双方言：OpenAI 兼容（DeepSeek 等）/ Anthropic |
| 权限门 | `ZCode/src/harness/permissions.ts` | ✅ | Plan（只读）/ Agent（逐调用审批，无审批者时 fail-closed）/ YOLO |
| 护栏 | `ZCode/src/harness/guardrails.ts` | ✅ | 最大轮数（`ZCODE_MAX_TURNS`）+ 累计 token 预算（`ZCODE_BUDGET_TOKENS`） |
| 会话转录 | `ZCode/src/harness/transcript.ts` | ✅ | JSONL 追加写；`~/.zcode/projects/<sha256(cwd)>/` |
| 上下文压缩 | `ZCode/src/harness/compact.ts` | ✅ | 输入 token 阈值触发（`ZCODE_COMPACT_TOKENS`，默认 100k）；保留最近 6 条原文；失败不压缩继续跑 |
| 会话恢复 | `ZCode/src/harness/resume.ts` | ✅ | `--continue` / `--resume <id\|path>` / `sessions` 子命令；逐行容错解析；read-before-edit 状态跨会话重建（v1.1.1 修复跨目录恢复的 cwd 解析） |
| Provider：OpenAI 兼容 | `ZCode/src/providers/openaiCompatible.js` | ✅ | 完整 SSE + tool_call 增量合并；429/5xx 指数退避重试（v1.1.1 补齐，含 retry-after） |
| Provider：Anthropic | `ZCode/src/providers/anthropic.js` | ✅ | SSE + 429/5xx 指数退避重试 |
| CLI | `ZCode/src/cli/publicCliCore.js` | ✅ | print 模式、doctor、models、sessions、cost 估算、`--json` 信封 |

## 3 验证方式

- **测试**：`npm test`（Node ≥ 24 原生 TS strip，零构建）—— 全量套件在 CI（Windows + Node 24）每次 push/PR 强制执行。harness 集成测试通过剧本式假 LLM SSE 服务器驱动**真循环 + 真 provider + 真工具**。
- **类型检查**：`npm run typecheck`，公共层 `strict: true`。
- **Lint**：`npm run lint`，ESLint 核心规则 + typescript-eslint recommended，只覆盖公共层。
- **真实验收**：[UC-03 验收留档](acceptance/uc03-acceptance.md) —— "修复所有失败的测试"任务在 DeepSeek 上无人工干预端到端通过，含运行日志与转录。

## 4 明确不做 / 计划中

| 能力 | 状态 | 计划 |
|------|------|------|
| 交互式 TUI | 未接线 | v1.2：零依赖 readline REPL（流式输出、内联审批、斜杠命令），裸 `zcode` 进入 |
| 文件工具工作区硬边界 | 未实现 | v1.2：默认锁 cwd，`--add-dir` 追加，`--no-boundary` 解除 |
| Bash 白/黑名单门控 | 未实现 | v1.2：只读命令白名单 + 危险命令黑名单 + env 覆盖 |
| 真沙箱（sandbox-runtime） | 未实现 | v2 方向；v1.2 先在文档中诚实声明信任模型边界 |
| MCP 接入 harness | 未接线（参考树有实现） | v1.3：stdio 先行 |
| 配置文件（`.zcode/settings.json`） | 未实现（当前仅环境变量） | v1.3 |
| 子 Agent / LSP 诊断 / hooks | 未实现 | v1.3 之后按需 |
| 移除遗留参考树 | **已完成（v1.4）** | 参考树已整体移出仓库；`src/` 现只含第一方公共层代码 |

## 5 遗留参考树已移除

`ZCode/src/` 曾是设计参考树（约 18.5 万行还原自 Claude Code 的 TS 源码，仅作行为对照、不进运行时）与公共层并存。v1.4 已将该参考树整体移出仓库，`src/` 现只含第一方公共层代码。详见 [`ZCode/src/README.md`](../ZCode/src/README.md)。

---

*最后更新：2026-09-03（v1.4.0）*
