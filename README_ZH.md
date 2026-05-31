# ZCode CLI Agent

> **终端原生 AI 编程助手** — 自然语言输入，工程任务自动执行。

[English](README.md) | [中文](README_ZH.md)

[![Stars](https://img.shields.io/github/stars/zmccyy/ZCode--CLI--agent?style=flat-square&logo=github)](https://github.com/zmccyy/ZCode--CLI--agent/stargazers)
[![License](https://img.shields.io/github/license/zmccyy/ZCode--CLI--agent?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)](https://github.com/zmccyy/ZCode--CLI--agent/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#-快速开始)

---

## 为什么需要 ZCode？

AI 编程工具大多绑定在浏览器或 IDE 里。**ZCode CLI Agent** 把完整的 Agent 循环搬进终端 —— 读文件、跑命令、搜代码、调 MCP 工具、提交改动，全程不离开 Shell。

对标 Claude Code 级终端 Agent 能力，ZCode 面向需要 **可脚本化、本地优先** AI 工作流的开发者，支持多模型接入与细粒度工具权限控制。

---

## ✨ 核心特性

- 🎯 **自然语言驱动编程** — 用口语描述任务，Agent 自动规划并调用工具执行
- 🔌 **多 Provider 支持** — Anthropic、AWS Bedrock、Google Vertex、Azure 及 OpenAI 兼容协议
- 🧰 **丰富工具链** — 文件读写、Shell、Grep、LSP、Skills 及可扩展 Agent 工具
- 🌐 **MCP 协议集成** — 通过 Model Context Protocol 接入外部工具服务器
- 🛡️ **权限精细管控** — 工具执行需审批，保障本地环境安全
- 📦 **脚本化 Print 模式** — `-p --json` 输出结构化结果，适合 CI 与自动化
- 🖥️ **Ink 交互式 TUI** — 支持会话恢复、上下文压缩与多层记忆系统

---

## 📸 演示

项目暂无截图，以下是公共 CLI 的实际输出：

```bash
$ cd ZCode && bun run doctor --json

{
  "productName": "ZCode",
  "version": "0.1.0",
  "startable": true,
  "provider": {
    "mode": "openai-compatible",
    "printReady": true,
    "modelCount": 1
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

> **提示：** Star 本仓库，跟踪交互式 TUI 与完整 Agent 链路的开发进展。

---

## 🚀 快速开始

**环境要求：** Node.js ≥ 22 · Bun ≥ 1.0（推荐）

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

### 公共 CLI（稳定本地入口）

| 命令 | 说明 |
|------|------|
| `bun run start --help` | 查看帮助 |
| `bun run doctor --json` | 运行时与 Provider 诊断 |
| `bun run models` | 列出可用模型 |
| `bun run start -p "..." --json` | 非交互式请求，JSON 输出 |

Node.js 同样可用：

```bash
npm start -- --help
npm run doctor -- --json
npm start -- -p "Summarize this repository" --json
```

### 完整交互式 REPL（Bun）

```bash
bun src/entrypoints/cli.tsx
```

完整 TUI 链路包含 MCP 管理、认证、插件、Skills、会话恢复及完整工具循环。架构详见 [系统设计说明书](docs/系统设计说明书.md)。

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
| 快速开始 | [docs/getting-started/quick-start.md](docs/getting-started/quick-start.md) |
| 本地开发 | [docs/guides/local-development.md](docs/guides/local-development.md) |
| API / 环境变量 | [docs/references/api-reference.md](docs/references/api-reference.md) |
| 系统设计 | [docs/系统设计说明书.md](docs/系统设计说明书.md) |

---

## ❓ 常见问题

**Q: 公共 CLI 和完整 REPL 有什么区别？**

公共构建（`publicCli.js`）提供稳定命令 — `help`、`doctor`、`models` 及 `-p` Print 模式 — 不启动完整 Ink TUI。完整 Agent 体验通过 `bun src/entrypoints/cli.tsx` 启动。

**Q: 支持哪些 LLM Provider？**

代码库支持 Anthropic、AWS Bedrock、Google Vertex、Azure Foundry 及任意 OpenAI 兼容端点。公共 Print 模式目前通过 `.env` 验证 OpenAI 兼容 Provider。

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
bun test          # 或: npm test
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

*最后更新：2026-05-31*
