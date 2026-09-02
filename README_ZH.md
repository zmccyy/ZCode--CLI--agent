# ZCode CLI Agent

> **终端原生 AI 编程助手** — 用自然语言描述任务，Agent 自动完成工程工作。

[English](README.md) | [中文](README_ZH.md)

[![CI](https://github.com/zmccyy/ZCode--CLI--agent/actions/workflows/ci.yml/badge.svg)](https://github.com/zmccyy/ZCode--CLI--agent/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/zmccyy/ZCode--CLI--agent?style=flat-square&logo=github)](https://github.com/zmccyy/ZCode--CLI--agent/stargazers)
[![License](https://img.shields.io/github/license/zmccyy/ZCode--CLI--agent?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.1-blue?style=flat-square)](https://github.com/zmccyy/ZCode--CLI--agent/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.0-f9f1e1?style=flat-square&logo=bun)](https://bun.sh)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#-快速开始)

---

## 📍 当前状态（2026-08）

| 能力 | 状态 |
|------|------|
| **Harness v1：真正的 Agent 循环** —— 多轮 Think→Act→Observe 工具循环 | ✅ 已交付（[计划](docs/plans/harness-v1-plan.md) · [ADR-0001](docs/adr/0001-progressive-port-clean-endgame.md)） |
| 核心六件套工具：Read / Glob / Grep / Write / Edit / Bash | ✅ 已交付 |
| 权限门三模式：Plan（只读）/ Agent（逐项审批）/ YOLO（全自动） | ✅ 已交付 |
| 护栏：默认 30 轮上限（可配置）+ token 预算 | ✅ 已交付 |
| JSONL 会话转录 | ✅ 已交付 |
| 双 provider 流式——OpenAI 兼容（DeepSeek）+ Anthropic 方言 | ✅ 已交付 |
| 验收场景 UC-03：「修复所有失败的测试」端到端、无人工干预 | ✅ 真实验收通过（[留档](docs/acceptance/uc03-acceptance.md)） |
| 完整源码树（TUI / MCP / LSP / 子 Agent） | 🧱 仅作参照 —— v1 之后接入 |

---

## 为什么需要 ZCode？

大多数 AI 编程工具绑在浏览器或 IDE 里。**ZCode CLI Agent** 把完整的 Agent 循环搬进终端——读文件、搜代码、改代码、跑测试，全程不离开 Shell。

从 **v1.0** 开始，`-p` 不再是一次性问答：它驱动真正的 Agent 运行时。模型用工具探索、动手修改、跑验证、如实汇报——直到任务完成或护栏触发。

---

## ✨ 核心特性

- 🎯 **真正的 Agent 循环** ✅ —— 多轮 Think→Act→Observe：模型调用工具、结果回灌、循环直至完成
- 🧰 **核心六件套** ✅ —— Read（分页 + 行号）、Glob（按修改时间排序）、Grep（正则 + 上下文 + 计数）、Write、Edit（唯一匹配精确替换）、Bash（Git Bash、超时、退出码）
- 🛡️ **权限门** ✅ —— Plan（只读）/ Agent（每次调用 y/n 确认，无交互时默认拒绝）/ YOLO（自动批准）
- 🚧 **护栏** ✅ —— 默认最多 30 轮 + 可配置 token 预算；触发即硬停并如实汇报进度
- 📼 **JSONL 转录** ✅ —— 每个会话落盘至 `~/.zcode/projects/<cwd-hash>/<sessionId>.jsonl`
- 🔌 **双 provider 路线** ✅ —— OpenAI 兼容接口（默认 DeepSeek）与 Anthropic；同一循环，两种线上方言
- 📦 **可脚本化 CLI** ✅ —— `-p --json` 信封含 `toolCalls[]` / `usage` / `stopReason`，可直接进 CI 管道
- 🖥️ **Ink 交互式 TUI** 🧱 —— 全屏 REPL 源码已具备，v1 之后接到 Harness 循环上
- 🌐 **MCP 协议集成** 🧱 —— 源码已具备完整 MCP 客户端，待接入
- ⌨️ **键盘驱动** 🧱 —— 可配置键绑定系统源码已具备
- 🪟 **Windows 优先** ✅ —— PowerShell 便携安装包、Git Bash 集成

---

## 📸 它真实的样子

真实验收运行（无人工干预，DeepSeek）——完整日志：[docs/acceptance/uc03-run-output.log](docs/acceptance/uc03-run-output.log)：

```
── YOLO MODE ──

● Bash({"command":"node --test 2>&1"})
  ✗ Error: command exited with code 1 … AssertionError: add should sum
Two clear bugs: `add` subtracts instead of adding, and `shout` lowercases
instead of uppercasing. Fixing both:

● Edit({"file_path":"calc.js","old_string":"  return a - b","new_string":"  return a + b"})
  ✓ File edited successfully (1 replacement)
● Bash({"command":"node --test 2>&1"})
  ✓ calc tests passed ✔  string tests passed ✔  pass 2 / fail 0
所有失败的测试均已修复，`node --test` 现在全部通过（2/2）。
```

```bash
$ zcode -p "修复所有失败的测试" --yolo              # 完整循环，自动批准
$ zcode -p "探索仓库并提出重构方案" --plan          # 只读探索，零写入
$ zcode -p "总结数据模型" --json                    # 机器可读信封
```

离线演示（无需 API Key，21 项检查）：

```bash
bash scripts/demo-all-features.sh        # 离线
bash scripts/demo-all-features.sh --live # 8 次真实 LLM 调用，需 .env
```

---

## 🚀 快速开始

**环境要求：** Node.js ≥ 24（原生 TS 类型剥离，零构建步骤）· Windows 上需 Git Bash

```bash
git clone https://github.com/zmccyy/ZCode--CLI--agent.git
cd ZCode--CLI--agent/ZCode
npm install
```

1. **创建 `.env`**（放在工作目录），填入 LLM 凭据
2. **自检** —— `npm run doctor -- --json`
3. **列模型** —— `npm run models`
4. **跑 Agent** —— `npm start -- -p "修复所有失败的测试" --yolo`
5. **可选** —— `npm link` 全局使用 `zcode`

### Windows 便携版安装

从 [Releases](https://github.com/zmccyy/ZCode--CLI--agent/releases) 下载或本地构建：

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\build-portable.ps1
powershell -ExecutionPolicy Bypass -File packaging\windows\install.ps1 -ZipPath .\dist\zcode-1.0.0-win-x64-portable.zip
```

任意终端输入 `zcode --help` 即可使用。详见 [Windows 安装指南](docs/guides/windows-install.md)。

<details>
<summary>最小 <code>.env</code>（OpenAI 兼容 / DeepSeek）</summary>

```dotenv
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-chat
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com/v1
ZCODE_OPENAI_API_KEY=your-api-key
```
</details>

---

## 💡 用法

### Agent 循环（无头模式）

| 命令 | 说明 |
|---------|-------------|
| `zcode -p "<任务>" --yolo` | 完整 Agent 循环，所有工具调用自动批准 |
| `zcode -p "<任务>" --plan` | 只读模式：探索与规划，拒绝一切写入 |
| `zcode -p "<任务>"` | Agent 模式：每个非只读调用前 y/n 确认（TTY；管道输入时默认拒绝） |
| `zcode -p "<任务>" --yolo --json` | 机器可读信封（见下） |
| `zcode -p "<任务>" --max-turns 10` | 收紧轮数护栏（env `ZCODE_MAX_TURNS`） |
| `zcode -p "<任务>" --reasoning` | 同时显示模型思考过程 |

环境变量：`ZCODE_MAX_TURNS`（轮数护栏，默认 30）· `ZCODE_BUDGET_TOKENS`（累计 token 预算）· `ZCODE_TRANSCRIPT_DIR`（覆盖转录目录）。

### JSON 信封

`--json` 在 v0 打印信封基础上向后兼容地扩展了 `toolCalls[]`（已执行调用及结果）、`usage` 与 `stopReason`：

```json
{
  "sessionId": "c0a55eeb-…",
  "provider": "openai-compatible:deepseek",
  "model": "deepseek-v4-flash",
  "text": "所有失败的测试均已修复并通过验证。",
  "toolCalls": [
    { "id": "call_1", "name": "Read", "input": {"file_path": "calc.js"},
      "result": "     1\tfunction add(a, b) {…", "isError": false, "durationMs": 3 },
    { "id": "call_2", "name": "Edit", "input": {"old_string": "a - b"},
      "result": "File edited successfully (1 replacement).", "isError": false, "durationMs": 12 }
  ],
  "usage": { "inputTokens": 18600, "outputTokens": 1100, "totalTokens": 19700 },
  "stopReason": "end_turn",
  "finishReason": "stop",
  "turns": 6,
  "runMode": "yolo"
}
```

`stopReason`：`end_turn` · `max_turns` · `budget_exceeded` · `aborted` · `error` —— 护栏触发时始终如实汇报已执行进度。

### 诊断命令（稳定）

| 命令 | 说明 |
|---------|-------------|
| `zcode doctor --json` | 运行时与 provider 诊断 |
| `zcode models` | 列出当前 provider 暴露的模型 |

### 交互式 REPL（Bun）

```bash
bun src/entrypoints/cli.tsx
```

全屏 TUI 源码（工具审批对话框、任务面板、键位系统）随仓库发布，将在 v1 之后接到 Harness 循环上。

---

## 🏗️ 架构

```
┌──────────────────────────────────────────────┐
│  CLI  (publicCli → publicCliCore)            │
│  print 模式 = 无头 Agent + JSON 信封          │
├──────────────────────────────────────────────┤
│  Harness v1  (src/harness，TS，零构建)        │
│  Agent 循环 · 6 工具 · 权限门                 │
│  护栏 · JSONL 转录                            │
├──────────────────────────────────────────────┤
│  Provider 层  (src/providers)                │
│  OpenAI 兼容 ⇄ tool_call 事件 ⇄ Anthropic     │
└──────────────────────────────────────────────┘
```

- **Agent 循环**（`src/harness/loop.ts`）—— provider 无关的 Think→Act→Observe 引擎；每次请求把内部消息翻译成对应的线上方言。
- **工具**（`src/harness/tools/`）—— 语义以参照工具集为准（Edit = 精确唯一匹配替换；Edit/Write 前必须先 Read；Bash = `bash -c` 带超时）。
- **测试** —— 脚本化的假 LLM 服务器（两种 SSE 方言）驱动**真实**循环、**真实** provider 适配器与**真实**工具；live e2e 在无 API key 时自动跳过。UC-03 证据归档于 [docs/acceptance/](docs/acceptance/)。

## 📚 文档

| 主题 | 链接 |
|-------|------|
| 文档中心 | [docs/README.md](docs/README.md) |
| Harness v1 计划 | [docs/plans/harness-v1-plan.md](docs/plans/harness-v1-plan.md) |
| 架构决策 | [docs/adr/0001-progressive-port-clean-endgame.md](docs/adr/0001-progressive-port-clean-endgame.md) |
| UC-03 验收证据 | [docs/acceptance/uc03-acceptance.md](docs/acceptance/uc03-acceptance.md) |
| 快速开始 | [docs/getting-started/quick-start.md](docs/getting-started/quick-start.md) |
| API / 环境变量 | [docs/references/api-reference.md](docs/references/api-reference.md) |
| Demo 演练 | [docs/guides/demo-walkthrough.md](docs/guides/demo-walkthrough.md) |

---

## ❓ FAQ

**Q：现在 `-p` 到底跑的是什么？**

完整的 Harness Agent 循环：模型用 Glob/Grep/Read 探索，用 Write/Edit 修改，用 Bash 验证，每个结果回灌循环直至模型不再调用工具或护栏触发。`--json` 把全过程暴露给管道。

**Q：公共 CLI 和完整 REPL 有什么区别？**

公共构建（`publicCli.js`）暴露稳定的无头表面——`help`、`doctor`、`models` 与 `-p` Agent 循环。完整交互 TUI 仍从 `bun src/entrypoints/cli.tsx` 启动。

**Q：支持哪些 LLM provider？**

任何 OpenAI 兼容端点（DeepSeek、Moonshot、vLLM……）与 Anthropic 第一方；同一循环讲两种线上方言。Bedrock / Vertex / Foundry 适配器在 provider 层中。

**Q：Agent 模式在 `-p` 下怎么请求批准？**

stdin 是 TTY 时，每个非只读工具调用都会提示 `[y/N]`。stdin 被管道化时（CI、脚本）默认拒绝（fail-closed）——并提示改用 `--yolo`。没有显式批准或 YOLO，任何操作都不会执行。

**Q：`--plan` 模式做什么？**

`--plan` 把权限门钉在只读档：探索工具自由运行，每个写操作/命令都被拒绝，并给出模型可见、可据此调整计划的解释性错误。

**Q：环境变量不生效？**

把 `.env` 放在当前工作目录。已存在的进程环境变量优先于 `.env`。

**Q：Node.js 还是 Bun？**

Node ≥ 24 能跑一切（Harness 用 TS 原生类型剥离直接运行——零构建）。只有尚未接线的 TUI 源码需要 Bun。

---

## 🤝 参与贡献

欢迎贡献！

- [报告问题](https://github.com/zmccyy/ZCode--CLI--agent/issues)
- [提交 PR](https://github.com/zmccyy/ZCode--CLI--agent/pulls)
- [提出建议](https://github.com/zmccyy/ZCode--CLI--agent/issues/new)

```bash
cd ZCode
npm test          # 全量测试（含假 LLM 剧本驱动的 Harness 循环测试）
npx tsc --noEmit -p tsconfig.public.json   # 类型检查
```

---

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=zmccyy/ZCode--CLI--agent&type=Timeline)](https://star-history.com/#zmccyy/ZCode--CLI--agent&Timeline)

---

## 📄 许可证

[MIT License](LICENSE) — Copyright (c) 2026 zmccyy

---

## 💞 致谢

灵感来自 Claude Code 开创的终端 Agent 范式。使用 [Ink](https://github.com/vadimdemedes/ink)、[Commander](https://github.com/tj/commander.js) 与 [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) 构建。

*最后更新：2026-08-31（Harness v1.0）*
