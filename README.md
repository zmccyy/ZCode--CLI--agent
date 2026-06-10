# ZCode CLI Agent

> **Your terminal-native AI coding agent** — describe the task, ship the work.

[English](README.md) | [中文](README_ZH.md)

[![Netlify Status](https://api.netlify.com/api/v1/badges/d3789373-6012-4500-be2c-3a1721923cb2/deploy-status)](https://app.netlify.com/projects/zcode-cli-agent/deploys)
[![zread](https://img.shields.io/badge/Ask_Zread-_.svg?style=flat-square&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff)](https://zread.ai/zmccyy/ZCode--CLI--agent)

[![Stars](https://img.shields.io/github/stars/zmccyy/ZCode--CLI--agent?style=flat-square&logo=github)](https://github.com/zmccyy/ZCode--CLI--agent/stargazers)
[![License](https://img.shields.io/github/license/zmccyy/ZCode--CLI--agent?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)](https://github.com/zmccyy/ZCode--CLI--agent/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.0-f9f1e1?style=flat-square&logo=bun)](https://bun.sh)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#-quick-start)
[![Tests](https://img.shields.io/badge/tests-795%2F801%20passing-success?style=flat-square)](#-quick-start)

---

## Why ZCode?

Most AI coding assistants are locked inside a browser tab or IDE window. **ZCode CLI Agent** puts the full agent loop right in your terminal — read files, run commands, search code, call MCP tools, edit with LSP diagnostics, and ship changes, all without leaving the shell.

It's Claude Code–class terminal agency, built for developers who want **scriptable, local-first AI workflows** with multi-model support, fine-grained tool permissions, and a persistent task system that survives restarts.

---

## ✨ Features

- 🎯 **Natural-language coding** — Describe tasks in plain language; the agent plans and executes with tools
- 🔌 **Multi-provider LLM** — Anthropic, AWS Bedrock, Google Vertex, Azure, and any OpenAI-compatible API
- 🧰 **Rich tool system** — File read/write/edit, shell, grep, glob, LSP diagnostics, skills, and extensible agents
- 🌐 **MCP integration** — Plug in external tools via Model Context Protocol servers
- 🛡️ **Permission control** — Four modes: Plan (preview only), Agent (ask per action), YOLO (auto-approve), Auto (bypass)
- 📦 **Scriptable CLI** — `-p --json` for CI pipelines; `--write`, `--plan`, `--yolo`, `--reasoning` flags
- 🖥️ **Interactive Ink TUI** — Full-screen REPL with session resume, context compression, and layered memory
- 💬 **Reasoning preview** — Stream model thinking blocks inline before tool calls and replies
- ⌨️ **Keyboard-driven** — Configurable keybindings: F1 help, Ctrl+K command palette, Ctrl+R history, chord sequences
- 📋 **Persistent tasks** — Create, track, and auto-restore task lists across sessions
- 🩺 **LSP diagnostics** — Auto-inject language server errors/warnings after file edits (toggleable)
- 🪟 **Windows-first** — Drive-letter path completion, backslash separators, portable installer via PowerShell

---

## 📸 Quick Demo

**Offline** (no API key needed, 21 checks):

```bash
bash scripts/demo-all-features.sh
```

**Live** (8 real LLM calls, requires `.env`):

```bash
bash scripts/demo-all-features.sh --live
```

See the full walkthrough at [docs/guides/demo-walkthrough.md](docs/guides/demo-walkthrough.md).

### Sample output

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
$ zcode -p "Explain this repository" --json

{
  "provider": "openai-compatible:deepseek",
  "model": "deepseek-chat",
  "text": "ZCode CLI Agent is a terminal-native AI coding assistant...",
  "toolCalls": [],
  "finishReason": "stop"
}
```

```bash
# New flags — preview without executing, write code to files, enable reasoning
$ zcode -p "Create a REST API" --plan           # analyze only, no execution
$ zcode -p "Write a Fibonacci script" --write fib.py
$ zcode -p "Optimize this algorithm" --reasoning  # stream thinking process
$ zcode -p "Deploy to staging" --yolo           # skip approval prompts
```

---

## 🚀 Quick Start

**Requirements:** Node.js ≥ 22 · Bun ≥ 1.0 (recommended for REPL)

```bash
git clone https://github.com/zmccyy/ZCode--CLI--agent.git
cd ZCode--CLI--agent/ZCode
bun install
```

1. **Create `.env`** with your LLM provider credentials
2. **Verify** — `bun run doctor --json`
3. **List models** — `bun run models`
4. **Run a prompt** — `bun run start -p "Explain this repo" --json`
5. **Optional** — `npm link` to use `zcode` globally

### Windows portable install

Download from [Releases](https://github.com/zmccyy/ZCode--CLI--agent/releases) or build locally:

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\build-portable.ps1
powershell -ExecutionPolicy Bypass -File packaging\windows\install.ps1 -ZipPath .\dist\zcode-0.1.0-win-x64-portable.zip
```

Then `zcode --help` from any terminal. See [Windows Install Guide](docs/guides/windows-install.md).

<details>
<summary>Minimal <code>.env</code> (OpenAI-compatible / DeepSeek)</summary>

```dotenv
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-chat
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com/v1
ZCODE_OPENAI_API_KEY=your-api-key
```
</details>

---

## 💡 Usage

### Public CLI (stable)

| Command | Description |
|---------|-------------|
| `bun run start --help` | Show all commands and flags |
| `bun run doctor --json` | Runtime & provider diagnostics |
| `bun run models` | List all 12 available models |
| `bun run start -p "..." --json` | One-shot prompt, JSON output |
| `bun run start -p "..." --plan` | Analyze without executing |
| `bun run start -p "..." --write output.py` | Generate and save code |
| `bun run start -p "..." --reasoning` | Stream thinking process |
| `bun run start -p "..." --yolo` | Auto-approve tool actions |

Node.js equivalent:

```bash
npm start -- --help
npm run doctor -- --json
npm start -- -p "Summarize this repository" --json
```

### Interactive REPL (Bun)

```bash
bun src/entrypoints/cli.tsx
```

The TUI gives you: streaming responses, tool approval dialogs, LSP diagnostics overlay, persistent task panel (Ctrl+T), transcript viewer (Ctrl+O), command palette (Ctrl+K), help overlay (F1), and full session persistence.

Start in Plan mode:

```bash
bun src/entrypoints/cli.tsx --plan
```

### JSON output schema

```json
{
  "provider": "deepseek",
  "model": "deepseek-chat",
  "messageId": "abc-123",
  "text": "Response content",
  "toolCalls": [],
  "finishReason": "stop"
}
```

Full env var reference → [API Reference](docs/references/api-reference.md)

---

## ⌨️ Keybindings

| Key | Action |
|-----|--------|
| `Ctrl+K` | Command palette |
| `F1` | Help overlay |
| `Ctrl+R` | History search / resume session |
| `Ctrl+T` | Task panel |
| `Ctrl+O` | Transcript viewer |
| `Ctrl+L` | Redraw screen |
| `Shift+Tab` | Cycle permission mode |
| `Meta+T` | Toggle reasoning/thinking |
| `Ctrl+C` / `Ctrl+D` | Interrupt / exit |

Keybindings are fully configurable via `~/.claude/keybindings.json`. See the [keybinding system](ZCode/src/keybindings/) for details.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│  CLI Entry  (publicCli / cli.tsx)       │
├─────────────────────────────────────────┤
│  Query Engine  ·  Session & Memory      │
├─────────────────────────────────────────┤
│  Tool System  ·  Permissions  ·  MCP    │
├─────────────────────────────────────────┤
│  Provider Layer  (Anthropic / OpenAI / …)│
└─────────────────────────────────────────┘
```

| Layer | Responsibility |
|-------|----------------|
| CLI | Command parsing, print mode, interactive REPL |
| Query Engine | Conversation loop, streaming, context compaction |
| Tools | File I/O, shell, search, LSP, skills, agents |
| Providers | Multi-vendor LLM routing & model registry |
| MCP | External tool server integration |

---

## 📚 Documentation

| Topic | Link |
|-------|------|
| Doc Hub | [docs/README.md](docs/README.md) |
| Requirements | [docs/requirements-analysis.md](docs/requirements-analysis.md) |
| Implementation | [docs/implementation-status.md](docs/implementation-status.md) |
| Quick Start | [docs/getting-started/quick-start.md](docs/getting-started/quick-start.md) |
| System Design | [docs/系统设计说明书.md](docs/系统设计说明书.md) |
| API / Env Vars | [docs/references/api-reference.md](docs/references/api-reference.md) |
| AI Development | [docs/guides/ai-development-methodology.md](docs/guides/ai-development-methodology.md) |
| Demo Walkthrough | [docs/guides/demo-walkthrough.md](docs/guides/demo-walkthrough.md) |

---

## ❓ FAQ

**Q: Public CLI vs full REPL — what's the difference?**

The public build (`publicCli.js`) exposes stable commands — `help`, `doctor`, `models`, and `-p` print mode — without booting the full Ink TUI. The complete agent experience lives at `bun src/entrypoints/cli.tsx`.

**Q: Which LLM providers are supported?**

Anthropic, AWS Bedrock, Google Vertex, Azure Foundry, and any OpenAI-compatible endpoint. The public print mode validates against OpenAI-compatible providers via `.env`.

**Q: What does `--plan` mode do?**

`--plan` runs the agent in read-only analysis mode. It explores, reads, and plans — but never edits, writes, or executes. You see what it *would* do before committing. Remove `--plan` to execute.

**Q: How does `--yolo` differ from Plan mode?**

`--yolo` auto-approves all tool actions without asking for permission. Useful in CI or when you fully trust the agent. `--plan` is the opposite — zero execution.

**Q: Environment variables not loading?**

Place `.env` in your current working directory. Existing process env vars take precedence over `.env`.

**Q: Node.js or Bun?**

Both run the public CLI. Bun is recommended for the full interactive REPL and faster startup.

---

## 🤝 Contributing

Contributions welcome!

- [Report an issue](https://github.com/zmccyy/ZCode--CLI--agent/issues)
- [Submit a pull request](https://github.com/zmccyy/ZCode--CLI--agent/pulls)
- [Suggest a feature](https://github.com/zmccyy/ZCode--CLI--agent/issues/new)

```bash
cd ZCode
bun test          # 801 tests, 795 passing
npx tsc --noEmit  # type-check
```

---

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=zmccyy/ZCode--CLI--agent&type=Timeline)](https://star-history.com/#zmccyy/ZCode--CLI--agent&Timeline)

---

## 📄 License

[MIT License](LICENSE) — Copyright (c) 2026 zmccyy

---

## 💞 Acknowledgments

Inspired by the terminal agent paradigm pioneered by Claude Code. Built with [Ink](https://github.com/vadimdemedes/ink), [Commander](https://github.com/tj/commander.js), and the [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk).

*Last updated: 2026-06-09*
