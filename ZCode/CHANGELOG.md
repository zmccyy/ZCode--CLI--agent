# ZCode v1.4.0 Changelog

## 2026-09-03 v1.4.0 (Endgame — 100% first-party code)

### Changed
- **移出参考树**：`src/` 下除公共层外的全部源码（约 1,950 个文件，约 18.5 万行还原自 Claude Code 的 TS 源码）整体删除；仓库现只含第一方公共层代码（见 ADR-0001）。
- **配置引用同步收紧**：`package.json` lint scope、`tsconfig.public.json`、`eslint.config.js` 收窄到公共层；补齐 `tui.js`、`runMode.js`、`configs.js` 覆盖；移除 `src/types/**`、`src/services/**` 与参考树测试引用。
- **测试套件精简**：删除参考树依赖测试（`phase2*`、`anthropicAdapterClient`、`providerAdapterClient`、`githubAppConstants`、`productConstants`、`publicEntryBranding` 等），保留公共层测试。

### Files
- Deleted: `src/` 下除公共层外全部源码
- Updated: `package.json`, `tsconfig.public.json`, `eslint.config.js`, `test/publicCli.test.js`, `src/README.md`, `src/harness/README.md`

---

## 2026-09-03 v1.3.0 (MCP Full Integration)

### Added
- **MCP 完整移植** — stdio 传输 + harness 工具暴露
  - MCP server 现在可以作为 harness 工具调用
  - 支持所有 208 个测试用例（语义参考）
- **配置化** — `.zcode/settings.json` 正式上线
  - 支持白/黑名单、boundary 配置
  - schema 集成到 `settingsContract`
- **完整命令集**
  - `mcp enable` / `mcp disable`
  - `mcp list`
  - `mcp connect` / `mcp disconnect`
  - `mcp reload`
  - `mcp ping`
  - `mcp logs`
  - `mcp debug`
  - `mcp help`
  - `mcp clear-logs`
  - `mcp version`
- **自动重连** + 日志系统
- **debug 模式**（详细日志）

### Changed
- 项目版本 bumped to 1.3.0
- 所有 MCP 相关代码已完整集成
- settings.json 加载 + 验证机制已上线

### Security
- 白/黑名单 + boundary 配置已收编进 settings
- 危险操作（如 sudo、rm -rf）仍被 deny list 严格阻止

### Files
- Added: `.zcode/settings.json` 模板 + schema
- Updated: package.json, CHANGELOG.md, src/commands/mcp/mcp.tsx

See full release notes in README.md for details.