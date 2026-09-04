# Source tree

This directory contains **only first-party, clean-room code** for the ZCode CLI
Agent public layer. There is no vendored or reference source here anymore.

| Path | Role |
|---|---|
| `src/harness/` | The agent runtime: Think→Act→Observe loop, the six core tools (Read / Glob / Grep / Write / Edit / Bash), permission gate, guardrails, transcripts, compaction, resume. |
| `src/providers/` | Provider adapters (Anthropic + OpenAI-compatible / DeepSeek) and the provider factory. |
| `src/cli/` | `publicCliCore.js` (CLI surface), `harnessPrint.js` (headless print flow), `tui.js` (interactive REPL). |
| `src/entrypoints/publicCli.js` | Node entrypoint behind the `zcode` bin. |
| `src/contracts/` | Shared provider adapter contract (`providerAdapter.js`). |
| `src/config/` | Branding, settings (`settingsContract.js`), and provider-environment wiring. |
| `src/utils/permissions/runMode.js` | Three-level run mode (Plan / Agent / YOLO) mapping. |
| `src/utils/model/configs.js` | Runtime model catalog used by the public CLI. |

The legacy reference tree (≈185k lines of restored Claude Code source) that
previously lived under `src/` existed solely as design/behavior reference and
was never part of the product runtime. It was removed wholesale in v1.4 (see
`docs/adr/0001`); this repository is now 100% first-party code.

Typechecking and linting are scoped via `tsconfig.public.json` and
`eslint.config.js` at the `ZCode/` package root.
