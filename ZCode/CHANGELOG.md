# ZCode Changelog

## 2026-09-05 v1.6.0 (TUI 界面优化 — 对标 Claude Code 观感)

> 以 Claude Code v2.x 实机截图为对标参考；全部优化在 CLI 渲染层完成（loop/types 零改动），每 Loop 配 fake-LLM 全链路测试。延续零依赖路线（依赖政策放宽为「真实痛点才引入最小包」，本轮全部自写）。

### Added
- **审批 diff 预览**：Agent 模式下 Edit/Write 审批前渲染红/绿行级 diff（`Edit → file (edit · +N −M)` 头 + 上下文折叠），TUI 与 print TTY 审批双路径生效。零依赖 LCS 行 diff（`diffPreview.js`，超 4000 行拒绝并降级），Write 覆写时对磁盘旧内容 diff、新文件预览头部 30 行。
- **TodoWrite 清单渲染**：`tool_execution_start` 携带完整清单 → 着色清单渲染（☒绿已完成 / ◐青进行中 / ☐灰待办），结束仅显示摘要行——替代原 160 字符截断。
- **流式 markdown**：`markdownStream.js` 纯数据解析器（text_delta → 结构化行事件：fence 开/关 + styled segments）——跨 delta 拼行、代码围栏框线、`**bold**`/`` `code` ``/标题着色；无色/非 TTY 自动直通。TUI 渲染层着色。
- **输入补全**：readline completer——`/` 前缀补全 11 个斜杠命令；`@` 前缀补全工作区文件（浅层遍历跳过 node_modules/.git 等，30s 缓存，上限 50 条）。
- **spinner 状态行**：Braille 帧（Windows Terminal）→ ASCII 帧（legacy conhost，按 `WT_SESSION` 探测），已用秒数实时刷新，首个可见事件即停（interval 生命周期严格清理）。
- **Claude Code 式外观**：像素 Z banner（logo + 版本/模型/cwd 三行信息）；每轮结束状态行 `[model] | dir git:(main*) | Context ▓▓░░░░░░░░ 12%`（git 状态来自环境探测，Context 按已知模型族上下文窗口估算，未知回退 128k）。
- 测试新增：`diffPreview` / `tuiTodoRender` / `markdownStream` / `completer` / `tuiChrome`，全量 **348 tests / 0 fail / 7 skip**。

---

## 2026-09-05 v1.5.0 (「真正可干活」— 提示词 / TUI / 工具 / 记忆 / Windows / 配置)

> 对标 OpenCode / Claude Code / Gemini CLI / Codex CLI / Aider 的差距分析立项；Loop Engineering 推进，全程 fake-LLM 全链路验证（[roadmap](../docs/harness/roadmap.md) 实测勾选）。

### Added
- **系统提示词工程（Loop 9）**：`buildAgentSystemPrompt` 全面重写——身份 + `<environment>` 块（cwd/平台/OS/日期/有效 shell/git 分支与脏文件数/模型/权限模式/边界）+ 工作纪律（理解→计划→最小改动→验证→恢复→收尾）+ 工具指南 + 沟通规范；Plan 模式专用只读纪律分支。新增 `envInfo.js` 环境探测（2s 超时优雅降级，TUI 每轮刷新）。
- **TUI v1.5（Loop 10）**：Esc 中断运行中的 turn（保留 Ctrl+C）；Shift+Tab 循环 plan/yolo/agent（安全梯度）；`/model`（列出+会话内切换）、`/mode`、`/reasoning`、`/save`（保存最近回复代码块）、`/memory`；状态行（首个事件自动擦除）；工具行着色（NO_COLOR/FORCE_COLOR/非 TTY 降级）；turn 汇总含耗时；反斜杠续行多行输入；排队消息提示。
- **TodoWrite 工具（Loop 11）**：会话级任务清单（单 in_progress 约束、全量快照语义、☐/◐/☒ 渲染）；readOnly——Plan 模式亦可规划。
- **WebFetch 工具（Loop 11）**：SSRF 防护（环回/RFC1918/链路本地/CGNAT/IPv6 本地 + 每跳重定向复验）、仅 http/https、512KB 字节上限、15s 超时、取消贯穿、HTML→文本剥离、max_chars 截断。
- **项目记忆（Loop 12）**：AGENTS.md / ZCODE.md 发现链（workspace → 父目录 3 层 → `~/.zcode`），注入系统提示词尾部，8KB 单文件截断，`/memory` 查看。
- **Windows 深化（Loop 13）**：`ZCODE_SHELL=powershell|pwsh` 切换 Bash 工具命令方言（描述/错误消息随动）；GBK 输出解码兜底（UTF-8 U+FFFD 损失评估 vs GB18030，win32 only）；doctor 强化（平台/终端/有效 shell/git 可用/transcript 目录可写/API key 存在性/项目记忆数，清除失实旧注记）。
- **配置接线（Loop 14，P1.4 落地）**：`loadSettingsFromDisk` 五层（user→project→local→flag→policy）接入 runCli；`settings.env` 补缺语义；provider/openaiCompatible 段经 `applyProviderSettingsToEnv` 生效；模型默认值链 `-m` > `settings.model`；doctor `effectiveSettings` 摘要（apiKey 仅存在性）。
- **`zcode www` 复活（Loop 15）**：`wwwMain` 接入命令分发（www 后旗标透传），本地宣传站服务器带端口回退与遍历加固。
- 测试新增：`systemPrompt` / `tuiInteractive` / `todoWebFetch` / `loopToolsV15` / `projectMemory` / `windowsV15` / `settingsWiring` / `wwwCommand`，全量 **305 tests / 0 fail / 7 skip**。

### Fixed
- Write 工具补齐 read-before-overwrite 强制（描述与行为一致，防误覆写）。
- WebFetch 重定向目标从 `location` 响应头读取（原误用响应体）。
- Anthropic `thinking_delta` → `reasoning_delta` 映射补齐（roadmap E3），`/reasoning` 与 print `--reasoning` 均可显示。

---

## 2026-09-05 v1.4.1 (P0 可靠性闭环 — Loop Engineering)

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