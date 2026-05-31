# ZCode CLI Agent

> **Your terminal-native AI coding agent** — natural language in, real engineering work out.

[English](README.md) | [中文](README_ZH.md)

[![Stars](https://img.shields.io/github/stars/zmccyy/ZCode--CLI--agent?style=flat-square&logo=github)](https://github.com/zmccyy/ZCode--CLI--agent/stargazers)
[![License](https://img.shields.io/github/license/zmccyy/ZCode--CLI--agent?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)](https://github.com/zmccyy/ZCode--CLI--agent/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#-quick-start)

---

## Why ZCode?

Most AI coding tools live in the browser or IDE. **ZCode CLI Agent** brings a full agent loop to your terminal — read files, run commands, search code, call MCP tools, and ship changes without leaving the shell.

Built as a Claude Code–class terminal agent, ZCode is designed for developers who want **scriptable, local-first AI workflows** with multi-model support and fine-grained tool permissions.

---

## ✨ Features

- 🎯 **Natural-language coding** — Describe tasks in plain language; the agent plans and executes with tools
- 🔌 **Multi-provider LLM** — Anthropic, AWS Bedrock, Google Vertex, Azure, and OpenAI-compatible APIs
- 🧰 **Rich tool system** — File I/O, shell, grep, LSP, skills, and extensible agent tools
- 🌐 **MCP integration** — Plug in external capabilities via Model Context Protocol servers
- 🛡️ **Permission control** — Granular approval for tool execution, keeping your machine safe
- 📦 **Scriptable print mode** — `-p --json` for CI, automation, and one-shot prompts
- 🖥️ **Ink-powered TUI** — Interactive REPL with session resume, context compression, and memory

---

## 📸 Demo

No screenshots yet — here's what the public CLI looks like today:

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
$ zcode -p "Summarize this repository" --json

{
  "provider": "openai-compatible:deepseek",
  "model": "deepseek-chat",
  "text": "ZCode CLI Agent is a terminal-native AI coding assistant...",
  "toolCalls": [],
  "finishReason": "stop"
}
```

> **Tip:** Star the repo to follow interactive TUI and full agent loop progress.

---

## 🚀 Quick Start

**Requirements:** Node.js ≥ 22 · Bun ≥ 1.0 (recommended)

```bash
git clone https://github.com/zmccyy/ZCode--CLI--agent.git
cd ZCode--CLI--agent/ZCode
bun install
```

1. **Create `.env`** in your working directory with your LLM provider credentials
2. **Verify setup** — `bun run doctor --json`
3. **List models** — `bun run models`
4. **Run a prompt** — `bun run start -p "Explain this repo" --json`
5. **Optional global install** — `npm link` then use `zcode` anywhere

<details>
<summary>Minimal <code>.env</code> example (OpenAI-compatible / DeepSeek)</summary>

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

### Public CLI (stable local entrypoint)

| Command | Description |
|---------|-------------|
| `bun run start --help` | Show help |
| `bun run doctor --json` | Runtime & provider diagnostics |
| `bun run models` | List available models |
| `bun run start -p "..." --json` | Non-interactive prompt with JSON output |

Node.js works the same way:

```bash
npm start -- --help
npm run doctor -- --json
npm start -- -p "Summarize this repository" --json
```

### Full interactive REPL (Bun)

```bash
bun src/entrypoints/cli.tsx
```

The full TUI path includes MCP management, auth, plugins, skills, session resume, and the complete tool loop. See [System Design](docs/系统设计说明书.md) for architecture details.

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

## 🏗️ Architecture at a Glance

```
┌─────────────────────────────────────────┐
│  CLI Entry  (publicCli / cli.tsx)     │
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
| Query Engine | Conversation loop, streaming, compaction |
| Tools | File, shell, search, LSP, skills, agents |
| Providers | Multi-vendor LLM routing & model registry |
| MCP | External tool server integration |

---

## 📚 Documentation

| Topic | Link |
|-------|------|
| Doc Hub | [docs/README.md](docs/README.md) |
| Quick Start | [docs/getting-started/quick-start.md](docs/getting-started/quick-start.md) |
| Local Development | [docs/guides/local-development.md](docs/guides/local-development.md) |
| API / Env Vars | [docs/references/api-reference.md](docs/references/api-reference.md) |
| System Design | [docs/系统设计说明书.md](docs/系统设计说明书.md) |

---

## ❓ FAQ

**Q: What's the difference between the public CLI and the full REPL?**

The public build (`publicCli.js`) exposes stable commands — `help`, `doctor`, `models`, and `-p` print mode — without booting the full Ink TUI. The full agent experience lives at `bun src/entrypoints/cli.tsx`.

**Q: Which LLM providers are supported?**

The codebase supports Anthropic, AWS Bedrock, Google Vertex, Azure Foundry, and any OpenAI-compatible endpoint. The public print mode currently validates against OpenAI-compatible providers via `.env`.

**Q: Environment variables not loading?**

Place `.env` in your current working directory. Existing process env vars take precedence over `.env` values.

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
bun test          # or: npm test
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

*Last updated: 2026-05-31*
