# ⚠️ Source tree notice — read before browsing

This directory mixes two very different kinds of code:

| Layer | Paths | Role |
|---|---|---|
| **Public layer** (the product) | `src/harness/`, `src/providers/`, `src/cli/publicCliCore.js`, `src/cli/harnessPrint.js`, `src/entrypoints/publicCli.js`, `src/contracts/`, `src/config/` | The actual runtime behind the `zcode` CLI: agent loop, core tools, permission gate, guardrails, transcripts, compaction, resume. Clean-room written, typed (`strict: true`), linted, and fully covered by tests in `test/harness/`. |
| **Legacy reference tree** | everything else under `src/` (components/, services/, tools/, utils/, …) | Design reference material only. It is **not** imported by the public layer, not linted, not shipped, and scheduled for removal from the repository (see [ADR-0001](../../docs/adr/0001-progressive-port-clean-endgame.md)). |

**The legacy tree is not part of the product.** Do not extend it, do not use it
as a style reference for new code, and do not treat its presence as an
endorsement — it exists solely so the public layer can be built against a
working reference until the remaining features (MCP, TUI) are ported in v1.3.

Removal plan: once v1.3 (MCP + settings file) ships and v1.4 lands, the legacy
tree is deleted wholesale and this repository contains only first-party code.

Typechecking and linting are deliberately scoped to the public layer only —
see `tsconfig.public.json` and `eslint.config.js` at the repository root of
the `ZCode/` package.
