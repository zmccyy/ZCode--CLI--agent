# ZCode CLI Agent

> **Your terminal-native AI coding agent** — describe the task, ship the work.

[English](README.md) | [中文](README_ZH.md)

[![Netlify Status](https://api.netlify.com/api/v1/badges/d3789373-6012-4500-be2c-3a1721923cb2/deploy-status)](https://app.netlify.com/projects/zcode-cli-agent/deploys)
[![zread](https://img.shields.io/badge/Ask_Zread-_.svg?style=flat-square&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff)](https://zread.ai/zmccyy/ZCode--CLI--agent)

[![CI](https://github.com/zmccyy/ZCode--CLI--agent/actions/workflows/ci.yml/badge.svg)](https://github.com/zmccyy/ZCode--CLI--agent/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/zmccyy/ZCode--CLI--agent?style=flat-square&logo=github)](https://github.com/zmccyy/ZCode--CLI--agent/stargazers)
[![License](https://img.shields.io/github/license/zmccyy/ZCode--CLI--agent?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.1-blue?style=flat-square)](https://github.com/zmccyy/ZCode--CLI--agent/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.0-f9f1e1?style=flat-square&logo=bun)](https://bun.sh)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#-quick-start)

---

## 📍 Current status (2026-08)

| Capability | State |
|------|------|
| **Harness v1: real agent loop** — multi-turn Think→Act→Observe with tools | ✅ Shipped ([plan](docs/plans/harness-v1-plan.md) · [ADR-0001](docs/adr/0001-progressive-port-clean-endgame.md)) |
| Core six tools: Read / Glob / Grep / Write / Edit / Bash | ✅ Shipped |
| Permission modes: Plan (read-only) / Agent (per-call approval) / YOLO | ✅ Shipped |
| Guardrails: 30-turn limit (configurable) + token budget | ✅ Shipped |
| JSONL session transcripts | ✅ Shipped |
| Dual-provider streaming — OpenAI-compatible (DeepSeek) + Anthropic dialect | ✅ Shipped |
| Acceptance UC-03: *"fix all failing tests"* end-to-end, no human input | ✅ Verified live ([evidence](docs/acceptance/uc03-acceptance.md)) |
| Full agent source tree (TUI / MCP / LSP / sub-agents) | 🧱 Reference only — wired after v1 |

---

## Why ZCode?

Most AI coding assistants are locked inside a browser tab or IDE window. **ZCode CLI Agent** puts the full agent loop in your terminal — read files, search code, edit code, run tests — without ever leaving the shell.

Since **v1.0**, `-p` is not a one-shot Q&A: it drives a real agent runtime. The model explores with tools, makes edits, runs verification, and reports honestly — until the task is done or a guardrail fires.

---

## ✨ Features

- 🎯 **Real agent loop** ✅ — Multi-turn Think→Act→Observe: the model calls tools, results feed back, repeat until done
- 🧰 **Core six tools** ✅ — Read (paginated, line numbers), Glob (mtime-sorted), Grep (regex, context lines, count mode), Write, Edit (unique-match replacement), Bash (Git Bash, timeouts, exit codes)
- 🛡️ **Permission gate** ✅ — Plan (read-only) / Agent (y/n per call, fail-closed headless) / YOLO (auto-approve)
- 🚧 **Guardrails** ✅ — Max 30 turns (default) + configurable token budget; stops hard and reports progress as-is
- 📼 **JSONL transcripts** ✅ — Every session persisted to `~/.zcode/projects/<cwd-hash>/<sessionId>.jsonl`
- 🔌 **Dual provider line** ✅ — OpenAI-compatible APIs (DeepSeek default) and Anthropic; same loop, two wire dialects
- 📦 **Scriptable CLI** ✅ — `-p --json` with `toolCalls[]` / `usage` / `stopReason` envelope for CI pipelines
- 🖥️ **Interactive Ink TUI** 🧱 — Full-screen REPL source exists; wired after Harness v1
- 🌐 **MCP integration** 🧱 — Full MCP client in the source tree, pending wiring
- ⌨️ **Keyboard-driven** 🧱 — Configurable keybinding system in the source tree
- 🪟 **Windows-first** ✅ — Portable PowerShell installer, Git Bash shell integration

---

## 📸 What it actually does

Real acceptance run (no human input, DeepSeek) — log: [docs/acceptance/uc03-run-output.log](docs/acceptance/uc03-run-output.log):

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
$ zcode -p "fix all failing tests" --yolo          # the full loop, auto-approved
$ zcode -p "explore and propose a refactor plan" --plan   # read-only, zero writes
$ zcode -p "summarize the schema" --json           # machine-readable envelope
```

Offline demo (no API key, 21 checks):

```bash
bash scripts/demo-all-features.sh        # offline
bash scripts/demo-all-features.sh --live # 8 real LLM calls, requires .env
```

---

## 🚀 Quick Start

**Requirements:** Node.js ≥ 24 (native TS type-stripping, zero build step) · Git Bash on Windows

```bash
git clone https://github.com/zmccyy/ZCode--CLI--agent.git
cd ZCode--CLI--agent/ZCode
npm install
```

1. **Create `.env`** in your working directory with your LLM credentials
2. **Verify** — `npm run doctor -- --json`
3. **List models** — `npm run models`
4. **Run the agent** — `npm start -- -p "fix all failing tests" --yolo`
5. **Optional** — `npm link` to use `zcode` globally

### Windows portable install

Download from [Releases](https://github.com/zmccyy/ZCode--CLI--agent/releases) or build locally:

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\build-portable.ps1
powershell -ExecutionPolicy Bypass -File packaging\windows\install.ps1 -ZipPath .\dist\zcode-1.0.0-win-x64-portable.zip
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

### The agent loop (headless)

| Command | Description |
|---------|-------------|
| `zcode -p "<task>" --yolo` | Full agent loop, all tool calls auto-approved |
| `zcode -p "<task>" --plan` | Read-only: explores and plans, denies every write |
| `zcode -p "<task>"` | Agent mode: asks y/n before every non-read-only call (TTY; fails closed when piped) |
| `zcode -p "<task>" --yolo --json` | Machine-readable envelope (see below) |
| `zcode -p "<task>" --max-turns 10` | Tighten the turn guardrail (env `ZCODE_MAX_TURNS`) |
| `zcode -p "<task>" --reasoning` | Also show model thinking blocks |

Env knobs: `ZCODE_MAX_TURNS` (turn guardrail, default 30) · `ZCODE_BUDGET_TOKENS` (cumulative token budget) · `ZCODE_TRANSCRIPT_DIR` (override transcript location).

### JSON envelope

`--json` extends the v0 print envelope backward-compatibly with `toolCalls[]` (executed calls with results), `usage`, and `stopReason`:

```json
{
  "sessionId": "c0a55eeb-…",
  "provider": "openai-compatible:deepseek",
  "model": "deepseek-v4-flash",
  "text": "All failing tests are fixed and verified.",
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

`stopReason`: `end_turn` · `max_turns` · `budget_exceeded` · `aborted` · `error` — guardrail stops always report the executed progress honestly.

### Diagnostics (stable)

| Command | Description |
|---------|-------------|
| `zcode doctor --json` | Runtime & provider diagnostics |
| `zcode models` | List models exposed by the active provider |

### Interactive REPL (zero-dependency TUI)

```bash
zcode
```

Bare `zcode` on a real TTY boots the interactive TUI — a zero-dependency readline REPL with streaming output, inline tool approval, slash commands, and session resume. Headless runs use `zcode -p "<task>"`.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────┐
│  CLI  (publicCli → publicCliCore)            │
│  print mode = headless agent + JSON envelope │
├──────────────────────────────────────────────┤
│  Harness v1  (src/harness, TS, zero build)   │
│  Agent loop · 6 tools · Permission gate      │
│  Guardrails · JSONL transcript               │
├──────────────────────────────────────────────┤
│  Provider layer  (src/providers)             │
│  OpenAI-compatible ⇄ tool_call events ⇄ Anthropic │
└──────────────────────────────────────────────┘
```

- **Agent loop** (`src/harness/loop.ts`) — provider-agnostic Think→Act→Observe engine; translates internal messages to either wire dialect per request.
- **Tools** (`src/harness/tools/`) — the six core tools are implemented clean-room in the harness; Edit = exact unique-match replacement, Edit/Write require a prior Read, Bash runs with timeouts. Tool semantics are self-documented in `tools/`.
- **Testing** — a scripted fake LLM server (both SSE dialects) drives the *real* loop, *real* provider adapters, and *real* tools in tests; live e2e skips automatically without an API key. UC-03 evidence is archived in [docs/acceptance/](docs/acceptance/).

## 📚 Documentation

| Topic | Link |
|-------|------|
| Doc Hub | [docs/README.md](docs/README.md) |
| Harness v1 plan | [docs/plans/harness-v1-plan.md](docs/plans/harness-v1-plan.md) |
| Architecture decision | [docs/adr/0001-progressive-port-clean-endgame.md](docs/adr/0001-progressive-port-clean-endgame.md) |
| UC-03 acceptance evidence | [docs/acceptance/uc03-acceptance.md](docs/acceptance/uc03-acceptance.md) |
| Quick Start | [docs/getting-started/quick-start.md](docs/getting-started/quick-start.md) |
| API / Env Vars | [docs/references/api-reference.md](docs/references/api-reference.md) |
| Demo Walkthrough | [docs/guides/demo-walkthrough.md](docs/guides/demo-walkthrough.md) |

---

## ❓ FAQ

**Q: What exactly does `-p` run now?**

The full harness agent loop: the model explores with Glob/Grep/Read, edits with Write/Edit, verifies with Bash, and every result feeds back until it stops calling tools or a guardrail fires. `--json` exposes the whole thing for pipelines.

**Q: Public CLI vs full REPL — what's the difference?**

The public build (`publicCli.js`) exposes the stable, headless surface — `help`, `doctor`, `models`, and the `-p` agent loop. The full interactive TUI boots from bare `zcode` on a TTY (via `publicCli.js` → `tui.js`); `-p` stays headless.

**Q: Which LLM providers are supported?**

Any OpenAI-compatible endpoint (DeepSeek, Moonshot, vLLM, …) and Anthropic first-party; the same loop speaks both wire dialects. Bedrock / Vertex / Foundry adapters exist in the provider layer.

**Q: How does Agent mode ask for approval in `-p` mode?**

When stdin is a TTY, every non-read-only tool call prompts `[y/N]`. When stdin is piped (CI, scripts), it fails closed — denied with guidance to re-run with `--yolo`. Nothing executes without either explicit approval or YOLO.

**Q: What does `--plan` mode do?**

`--plan` runs the loop with the permission gate pinned to read-only: exploration tools run freely, every write/command is denied with an explanatory error the model can see and plan around.

**Q: Environment variables not loading?**

Place `.env` in your current working directory. Existing process env vars take precedence over `.env`.

**Q: Node.js or Bun?**

Node ≥ 24 runs everything (the harness is TS run via native type-stripping — zero build). Bun is only needed for the not-yet-wired TUI source.

---

## 🤝 Contributing

Contributions welcome!

- [Report an issue](https://github.com/zmccyy/ZCode--CLI--agent/issues)
- [Submit a pull request](https://github.com/zmccyy/ZCode--CLI--agent/pulls)
- [Suggest a feature](https://github.com/zmccyy/ZCode--CLI--agent/issues/new)

```bash
cd ZCode
npm test          # full suite incl. harness loop tests (fake-LLM scripted)
npx tsc --noEmit -p tsconfig.public.json   # type-check
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

*Last updated: 2026-08-31 (Harness v1.0)*
