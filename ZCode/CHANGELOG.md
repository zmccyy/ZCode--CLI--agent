# ZCode v1.2.0 Changelog

## 2026-09-03 v1.2.0 (Sandbox Hardening)

### Added
- Workspace boundary protection (`boundary.ts`) — file tools (Read/Glob/Grep/Write/Edit) strictly confined to cwd + --add-dir
- Bash command policy (`bashPolicy.ts`) — allow/deny/ask gating with hardcoded safe lists
- Zero-dependency TUI — removed readline dependency, using native Node + Ink
- Hardened permission modes (Plan/Agent/YOLO) with fail-closed behavior

### Changed
- Project version bumped to 1.2.0
- All commits tagged v1.2.0

### Security
- All dangerous operations (sudo, rm -rf, pipe to sh, etc.) blocked by deny list
- Boundary violations return clear error messages

### Files
- Added: src/harness/boundary.ts, src/harness/bashPolicy.ts, src/cli/tui.js
- Updated: package.json, CHANGELOG.md

See full release notes in README.md for details.
