# ZCode CLI Agent

> **终端原生 AI 编程助手** — 用自然语言描述任务，Agent 自动完成工程工作。

[English](README.md) | [中文](README_ZH.md)

[![Stars](https://img.shields.io/github/stars/zmccyy/ZCode--CLI--agent?style=flat-square&logo=github)](https://github.com/zmccyy/ZCode--CLI--agent/stargazers)
[![License](https://img.shields.io/github/license/zmccyy/ZCode--CLI--agent?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)](https://github.com/zmccyy/ZCode--CLI--agent/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.0-f9f1e1?style=flat-square&logo=bun)](https://bun.sh)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#-快速开始)
[![Tests](https://img.shields.io/badge/tests-795%2F801%20passing-success?style=flat-square)](#-快速开始)

---

## 为什么需要 ZCode？

大多数 AI 编程工具绑在浏览器或 IDE 里。**ZCode CLI Agent** 把完整的 Agent 循环搬进了终端——读文件、跑命令、搜代码、调 MCP 工具、编辑并检查 LSP 诊断、提交改动，全程不离开 Shell。

对标 Claude Code 级终端 Agent 能力，ZCode 面向需要 **可脚本化、本地优先** AI 工作流的开发者，支持多模型接入、细粒度权限控制，以及跨会话持久化的任务系统。

---

## ✨ 核心特性

- 🎯 **自然语言编程** — 用口语描述任务，Agent 自动规划并调用工具执行
- 🔌 **多 Provider 支持** — Anthropic、AWS Bedrock、Google Vertex、Azure 及任意 OpenAI 兼容 API
- 🧰 **丰富工具链** — 文件读写/编辑、Shell、Grep、Glob、LSP 诊断、Skills、可扩展 Agent
- 🌐 **MCP 协议集成** — 通过 Model Context Protocol 接入外部工具服务器
- 🛡️ **四级权限控制** — Plan（仅预览）、Agent（逐项审批）、YOLO（自动批准）、Auto（完全放行）
- 📦 **脚本化 CLI** — `-p --json` 用于 CI 流水线；`--write`、`--plan`、`--yolo`、`--reasoning` 标志
- 🖥️ **Ink 交互式 TUI** — 全屏 REPL，支持会话恢复、上下文压缩与多层记忆系统
- 💬 **推理过程预览** — 实时流式展示模型思考过程，区分 Think→Act→Observe→Reply 阶段
- ⌨️ **键盘驱动** — 可配置快捷键：F1 帮助、Ctrl+K 命令面板、Ctrl+R 历史搜索、和弦序列
- 📋 **持久化任务** — 创建、追踪任务列表，跨会话自动恢复
- 🩺 **LSP 诊断注入** — 文件编辑后自动收集语言服务器错误/警告（可关闭）
- 🪟 **Windows 优先** — 盘符路径补全、反斜杠分隔符、PowerShell 便携安装包

---

## 📸 快速演示

**离线模式**（无需 API Key，21 项检查）：

```bash
bash scripts/demo-all-features.sh
```

**实时模式**（8 次真实 LLM 调用，需配置 `.env`）：

```bash
bash scripts/demo-all-features.sh --live
```

完整演示脚本见 [docs/guides/demo-walkthrough.md](docs/guides/demo-walkthrough.md)。

### 示例输出

```bash
$ cd ZCode && bun run doctor --json

{
  "productName": "ZCode",
  "version": "0.1.0",
  "startable": true,
  "provider": {
    "mode": "openai-compatible",
    "printReady": true,
    "modelCount": 12
  },
  "commands": ["help", "doctor", "models", "print"]
}
```

```bash
$ zcode -p "总结这个仓库" --json

{
  "provider": "openai-compatible:deepseek",
  "model": "deepseek-chat",
  "text": "ZCode CLI Agent 是一个终端原生 AI 编程助手...",
  "toolCalls": [],
  "finishReason": "stop"
}
```

```bash
# 新增标志 — 预览不执行、写入代码文件、启用推理过程
$ zcode -p "创建一个 REST API" --plan           # 仅分析，不执行
$ zcode -p "写一个斐波那契脚本" --write fib.py
$ zcode -p "优化这个算法" --reasoning             # 流式展示思考过程
$ zcode -p "部署到测试环境" --yolo               # 跳过审批提示
```

---

## 🚀 快速开始

**环境要求：** Node.js ≥ 22 · Bun ≥ 1.0（REPL 推荐）

```bash
git clone https://github.com/zmccyy/ZCode--CLI--agent.git
cd ZCode--CLI--agent/ZCode
bun install
```

1. **创建 `.env`** — 在工作目录配置 LLM Provider 凭证
2. **验证环境** — `bun run doctor --json`
3. **查看模型** — `bun run models`
4. **发起请求** — `bun run start -p "解释这个仓库" --json`
5. **可选全局安装** — `npm link` 后任意目录使用 `zcode`

### Windows 便携安装

从 [GitHub Releases](https://github.com/zmccyy/ZCode--CLI--agent/releases) 下载便携 ZIP，或本地构建：

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\build-portable.ps1
powershell -ExecutionPolicy Bypass -File packaging\windows\install.ps1 -ZipPath .\dist\zcode-0.1.0-win-x64-portable.zip
```

安装后在任意终端执行 `zcode --help`。详见 [Windows 安装指南](docs/guides/windows-install.md)。

<details>
<summary>最小 <code>.env</code> 示例（OpenAI 兼容 / DeepSeek）</summary>

```dotenv
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-chat
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com/v1
ZCODE_OPENAI_API_KEY=your-api-key
```
</details>

---

## 💡 使用示例

### 公共 CLI（稳定入口）

| 命令 | 说明 |
|------|------|
| `bun run start --help` | 查看所有命令和标志 |
| `bun run doctor --json` | 运行时与 Provider 诊断 |
| `bun run models` | 列出全部 12 个可用模型 |
| `bun run start -p "..." --json` | 单次请求，JSON 输出 |
| `bun run start -p "..." --plan` | 仅分析，不执行 |
| `bun run start -p "..." --write output.py` | 生成代码并写入文件 |
| `bun run start -p "..." --reasoning` | 流式展示推理过程 |
| `bun run start -p "..." --yolo` | 自动批准工具操作 |

Node.js 同样可用：

```bash
npm start -- --help
npm run doctor -- --json
npm start -- -p "总结这个仓库" --json
```

### 完整交互式 REPL（Bun）

```bash
bun src/entrypoints/cli.tsx
```

TUI 提供：流式回复、工具审批弹窗、LSP 诊断叠加、持久化任务面板（Ctrl+T）、对话记录查看器（Ctrl+O）、命令面板（Ctrl+K）、帮助覆盖层（F1）、完整会话持久化。

以 Plan 模式启动：

```bash
bun src/entrypoints/cli.tsx --plan
```

### JSON 输出格式

```json
{
  "provider": "deepseek",
  "model": "deepseek-chat",
  "messageId": "abc-123",
  "text": "响应内容",
  "toolCalls": [],
  "finishReason": "stop"
}
```

完整环境变量说明 → [API 参考](docs/references/api-reference.md)

---

## ⌨️ 快捷键

| 按键 | 功能 |
|------|------|
| `Ctrl+K` | 命令面板 |
| `F1` | 帮助覆盖层 |
| `Ctrl+R` | 历史搜索 / 恢复会话 |
| `Ctrl+T` | 任务面板 |
| `Ctrl+O` | 对话记录查看器 |
| `Ctrl+L` | 刷新屏幕 |
| `Shift+Tab` | 循环切换权限模式 |
| `Meta+T` | 切换推理/思考模式 |
| `Ctrl+C` / `Ctrl+D` | 中断 / 退出 |

快捷键可通过 `~/.claude/keybindings.json` 完全自定义。详见 [键绑定系统](ZCode/src/keybindings/)。

---

## 🏗️ 架构概览

```
┌─────────────────────────────────────────┐
│  CLI 入口  (publicCli / cli.tsx)       │
├─────────────────────────────────────────┤
│  查询引擎  ·  会话与记忆管理            │
├─────────────────────────────────────────┤
│  工具系统  ·  权限控制  ·  MCP          │
├─────────────────────────────────────────┤
│  Provider 层  (Anthropic / OpenAI / …)  │
└─────────────────────────────────────────┘
```

| 层次 | 职责 |
|------|------|
| CLI | 命令解析、Print 模式、交互式 REPL |
| 查询引擎 | 对话循环、流式输出、上下文压缩 |
| 工具系统 | 文件、Shell、搜索、LSP、Skills、Agent |
| Provider | 多厂商 LLM 路由与模型注册 |
| MCP | 外部工具服务器集成 |

---

## 📚 文档导航

| 分类 | 链接 |
|------|------|
| 文档中心 | [docs/README.md](docs/README.md) |
| 需求分析 | [docs/requirements-analysis.md](docs/requirements-analysis.md) |
| 代码实现 | [docs/implementation-status.md](docs/implementation-status.md) |
| 快速开始 | [docs/getting-started/quick-start.md](docs/getting-started/quick-start.md) |
| 系统设计 | [docs/系统设计说明书.md](docs/系统设计说明书.md) |
| API / 环境变量 | [docs/references/api-reference.md](docs/references/api-reference.md) |
| AI 开发方法 | [docs/guides/ai-development-methodology.md](docs/guides/ai-development-methodology.md) |
| 演示脚本 | [docs/guides/demo-walkthrough.md](docs/guides/demo-walkthrough.md) |

---

## ❓ 常见问题

**Q: 公共 CLI 和完整 REPL 有什么区别？**

公共构建（`publicCli.js`）提供稳定命令 — `help`、`doctor`、`models` 及 `-p` Print 模式 — 不启动完整 Ink TUI。完整 Agent 体验通过 `bun src/entrypoints/cli.tsx` 启动。

**Q: 支持哪些 LLM Provider？**

支持 Anthropic、AWS Bedrock、Google Vertex、Azure Foundry 及任意 OpenAI 兼容端点。公共 Print 模式通过 `.env` 验证 OpenAI 兼容 Provider。

**Q: `--plan` 模式做什么？**

`--plan` 以只读分析模式运行 Agent。它会探索、阅读、规划——但绝不编辑、写入或执行任何操作。你会看到它 **打算** 做什么，确认后再去掉 `--plan` 实际执行。

**Q: `--yolo` 和 Plan 模式有什么区别？**

`--yolo` 自动批准所有工具操作，无需逐项确认。适用于 CI 或完全信任 Agent 的场景。`--plan` 则完全相反——零执行。

**Q: 环境变量不生效？**

将 `.env` 放在当前工作目录。已存在于进程中的环境变量优先级高于 `.env`。

**Q: 用 Node.js 还是 Bun？**

两者均可运行公共 CLI。完整交互式 REPL 推荐使用 Bun，启动更快。

---

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request！

- [报告问题](https://github.com/zmccyy/ZCode--CLI--agent/issues)
- [提交 PR](https://github.com/zmccyy/ZCode--CLI--agent/pulls)
- [功能建议](https://github.com/zmccyy/ZCode--CLI--agent/issues/new)

```bash
cd ZCode
bun test          # 801 项测试，795 通过
npx tsc --noEmit  # 类型检查
```

---

## 🌟 Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=zmccyy/ZCode--CLI--agent&type=Timeline)](https://star-history.com/#zmccyy/ZCode--CLI--agent&Timeline)

---

## 📄 许可证

[MIT License](LICENSE) — Copyright (c) 2026 zmccyy

---

## 💞 致谢

受 Claude Code 终端 Agent 范式启发。基于 [Ink](https://github.com/vadimdemedes/ink)、[Commander](https://github.com/tj/commander.js) 与 [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) 构建。

*最后更新：2026-06-09*
