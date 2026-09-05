# ZCode Changelog

## Unreleased (P0 可靠性闭环 — Loop Engineering，2026-09-05)

> 开发契约与证据：[docs/harness/](../docs/harness/README.md)（31 篇权威文档体系 + roadmap 实测勾选）。

### Fixed（可靠性 P0）
- **取消语义（P0-B）**：`consumeTurn` 要求 provider 流以 `response_end` 闭合——abort/EOF/截断不再被误报为 `end_turn`；中断轮不写入历史（防悬空 tool_call）。AbortSignal 贯穿 provider 请求、Bash 子进程、Glob/Grep 遍历与重试退避；Bash 超时/取消终止**整个进程树**（win32 `taskkill /T /F`，POSIX 进程组）。实测 abort→返回 150–550ms。
- **重试收编（P0-B）**：loop 经 `streamInput.maxRetries=0` 成为唯一重试所有者——单轮最坏 HTTP 请求从 9 次降为 3 次；协议错误（malformed/EOF）不重试；malformed SSE 事件跳过计数、连续 10 个升级为错误（OpenAI 与 Anthropic 行为统一）。
- **边界 realpath 化（P0-C）**：文件工具路径解析升级为词法 + 文件系统真相双重校验——工作区内 symlink/junction 指向边界外时 Read/Write/Edit/Glob/Grep 全部拒绝；遍历显式跳过 symlink（不跟随、无 cycle）、根为文件返回明确结果、新增字节/时间预算。
- **会话恢复可信化（P0-D）**：read-before-edit 只从**成功执行**的 Read 播种（失败/被拒/中断的 Read 不再解锁 Edit）；transcript 落盘前对 API key/Authorization 等敏感值脱敏为 `[REDACTED]`；transcript 写失败以 `AgentLoopResult.warnings[]` 可见（CLI stderr / TUI / JSON envelope）。
- **确定性测试（P0-A）**：bashPolicy loop 集成测试不再真实执行 `npm install`（历史抖动 316s → 224ms 离线）；新增用例超时。

### Changed
- **CLI 契约（P0-E）**：`--plan` 与 `--write` 组合即拒绝（Plan 模式零写入承诺含 CLI 后处理）；退出码映射 `end_turn→0 / 用法错误→2 / 护栏→3 / 取消→130 / 运行错误→1`；`-p --json` envelope 增加可选 `warnings[]`。
- **文档校正**：implementation-status 状态矩阵、api-reference（doctor 示例/退出码/Provider 矩阵/sessions）、双语 README 徽章与能力表与代码一致；历史 v1.3「MCP Full Integration」声明标注为与当前代码不符（MCP 移至 P1 规划）。

### Added
- `docs/harness/` 权威开发文档体系（31 篇）：架构/契约/工作流/测试/安全/运维/roadmap。
- 测试：`turnProtocol.test.js`（9 用例 abort/协议矩阵）、`boundaryRealpath.test.js`（8 用例）、`resumeReadSeed.test.js`（7 用例）、CLI 退出码/plan+write 回归。全套 245 tests / 0 fail / ~18s。

---

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