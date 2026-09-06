# Roadmap —— 唯一活跃开发计划（P0–P2）

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-06
> 执行方式：Loop Engineering —— 每个 Loop：改 → `typecheck+lint+test` 全绿 → 记录证据 → 下一 Loop。失败就地修复，不可定位则回退该 Loop 改动。
> 工程根：`ZCode/`。不新增运行时依赖；不触碰根 `package.json` 现场修改与 `.zcode/`；不自动 git 提交。

## P0 可靠性闭环（本次自治开发交付）

### Loop 2 · P0-A 确定性测试基线 ✅（2026-09-05）
- [x] A1：`bashPolicy.test.js` loop 集成用例注入 fake runner/fixture，杜绝真实 `npm install` 与网络（ask 桶改用 `node -e`，224ms 离线完成；两集成用例加 30s 超时）
- [x] 测试无残留子进程/服务器/临时目录；单用例与套件超时存在
- **Gate ✅**：`npm test` 219 tests / 0 fail / 18.4s；普通测试零网络

### Loop 3 · P0-B 取消与流协议 ✅（2026-09-05）
- [x] B1：`consumeTurn` 要求 `response_end` 闭合；EOF/malformed/截断 → 协议错误；abort → `stopReason='aborted'`（中断轮不写入历史，防悬空 tool_call）
- [x] B2：Bash 监听 `context.signal`；超时/取消 kill 进程树（win32 taskkill /T /F；POSIX 进程组）
- [x] B3：Glob/Grep/walk 贯穿 signal
- [x] B4：统一 retry——loop 经 `streamInput.maxRetries=0` 收编 provider 内建重试，单轮最坏请求从 9 降为 3
- [x] B5：loop backoff signal-aware（`abortableDelay`）
- [x] 测试：`turnProtocol.test.js` 9 用例——EOF×2（双方言）、malformed 跳过/升级、abort 矩阵×5（首字节前/文本中/Bash 中/退避中/anthropic）
- **Gate ✅**：abort 实测 150–550ms 返回（门 2s）；abort 不落 `end_turn`；协议错误不重试；228 tests 0 fail

### Loop 4 · P0-C 文件边界与进程安全 ✅（2026-09-05）
- [x] C1：boundary realpath 化——`assertRealpathInsideBoundary`：最近存在祖先 realpath + 词法尾部拼接；根 realpath 缓存；win32 大小写归一；`resolveWorkspacePath` 升级为 async 双重校验（词法 + 文件系统真相）
- [x] C2：fsWalk 显式跳过 symlink/junction（不跟随、不产出、无 cycle）、根为文件返回单条目、新增 maxTotalBytes/maxWalkMs 预算
- [x] 测试：`boundaryRealpath.test.js` 8 用例（junction 逃逸、symlink 文件逃逸、real-prefix 写入回归、sibling-prefix、walk 预算/文件根/自引用 junction）
- **Gate ✅**：越界 0；236 tests 0 fail（本机 2 个 file-symlink 用例因权限 skip，junction 用例覆盖同等防护）

### Loop 5 · P0-D transcript/resume 可信化 ✅（2026-09-05）
- [x] D1：`collectReadFilesFromMessages`（resume.ts）——只从**成功执行**的 Read（有对应非 error tool 结果）播种 readFiles；失败/被拒/中断的 Read 不播种；loop.ts 弃用意图式 `rebuildReadFilesFromMessage`
- [x] D2：transcript 写失败 → `AgentLoopResult.warnings[]`（types.ts 新字段）→ CLI stderr `WARNING:` / TUI `⚠` / JSON envelope `warnings`
- [x] D3：transcript 序列化层 redaction——sk-/key-/ghp_/xox + Authorization/x-api-key/api_key 头与赋值 → `[REDACTED]`，行保持可解析
- [x] 测试：`resumeReadSeed.test.js` 7 用例（失败/成功/无结果/跨 cwd 播种、端到端 resume 后 Edit 仍被拒、redaction 落盘、写失败 warning）
- **Gate ✅**：恢复语义回归全绿；敏感值不落盘；243 tests 0 fail

### Loop 6 · P0-E CLI 契约与事实校正 ✅（2026-09-05）
- [x] E1：`--plan` + `--write` 组合在 parseArgv 即拒绝（UsageError → 退出码 2）；CLI 回归锁定
- [x] 退出码映射实现：end_turn→0、UsageError→2、max_turns/budget→3、aborted→130、其余错误→1（contracts/23 落地）
- [x] E4：事实校正——implementation-status 状态矩阵、api-reference（doctor 示例/envelope 字段/Provider 矩阵/退出码/sessions）、双语 README 徽章与能力表、docs/README 导航 + historical 声明
- **Gate ✅**：CLI 测试全绿；文档声明与代码/测试一致（245 tests 0 fail）

### Loop 7 · 收尾 ✅（2026-09-05）
- [x] 本 roadmap 勾选、`ZCode/CHANGELOG.md` 记 Unreleased（含 v1.3 MCP 声明校正）
- [x] 文档链接检查：31 篇 0 断链；doctor/models 冒烟正常；plan+write→2、bad option→2 实测
- [x] 最终全量验证：**245 tests / 238 pass / 0 fail / 7 skip / 18.0s** + typecheck/lint 0 error

## P0 完成总结（2026-09-05）

P0 可靠性闭环交付：确定性测试基线（P0-A）、取消与流协议（P0-B）、realpath 边界（P0-C）、transcript/resume 可信化（P0-D）、CLI 契约与事实校正（P0-E）。每步 Loop 均有 Gate 证据，roadmap 勾选即为验收记录。后续 P1（契约版本化/观测/MCP stdio/配置接线/StuckDetector）与 P2（工作流/子 Agent/沙箱）按本 roadmap 推进。

## P1 扩展运行时（部分已落地，其余规划中）

> 状态以下方 Loop 记录为准：P1.4 配置接线已由 Loop 14 交付 ✅；P1.2 观测（metrics）与 P1.5 有界 StuckDetector 已交付 ✅（2026-09-06，`metrics.ts` + `stuckDetector.ts`，测试 `metrics.test.js` / `stuckDetector.test.js`）；P1.1 契约版本化已交付 ✅（2026-09-06，按 contracts/22 冻结设计实装：ToolDefinition v2 字段 + 注册校验 + loop 超时/输出预算强制 + 工具错误码词表 + Provider/Event 契约版本，测试 `toolContract.test.js`）；**P1.3 MCP stdio 最小子集已交付 ✅（2026-09-06，contracts/25）**；其余各项仍为规划。

1. **契约版本化** ✅：见上与 contracts/22（P1.1）；contracts/21 的 Provider `contractVersion` 校验同批落地。
2. **观测与 benchmark** ✅ metrics 部分：`src/harness/metrics.ts` 采集器（turn 时长/TTFT/工具聚合/retry/tokens/RSS）随 `AgentLoopResult.metrics` 返回，print JSON 信封透传，TUI turn 摘要行内联 ttft 与工具数；benchmark harness 仍为规划。
3. **MCP stdio 最小子集** ✅（2026-09-06，契约 [contracts/25](contracts/25-mcp-adapter-contract.md)）：handshake（initialize + initialized，协议版本 fail-fast）、tools/list（跟随 cursor）+ tools/call、`mcp__<server>__<tool>` registry 名 + `mcp.<server>.<tool>` namespace 双形、统一权限/边界/审计（annotations 视为 untrusted hints → 一律非只读）、每调用死线（默认 30s）+ 崩溃即时失败 + 有界重连（预算 2 次/会话，耗尽禁用）、默认关闭（无配置零进程）。v1 启动器限定 Node 脚本（固定 `node` + argv 数组、无 shell）；任意可执行文件 → P2 与安全策略白名单集成。测试 `mcp.test.js` 15 用例（fake MCP server 真实 stdio 全链路）+ settingsContract mcpServers 归一化；`mcp list/ping` 等 CLI 命令待适配器稳定后续接（按本条原计划）。
- **Gate ✅（2026-09-06）**：fake MCP 全链路稳定（15/15）；工具名零冲突（`mcp__` 前缀 + 发现层去重 + registry 唯一性不因 MCP 配置抛错）；主 loop 不被 server 阻塞（发现死线化、每调用死线化、崩溃即时拒绝 pending）；warm call p95 = 1ms，与直接内置工具 p95 比 **1.00× ≤ 1.25×**（20 次同轮 echo/TodoWrite 对照基准，fake LLM 驱动真循环）。全量 Gate：**429 tests / 421 pass / 0 fail / 8 skip；typecheck + lint 0 错**。
4. **配置接线** ✅（Loop 14，见下方记录）：settings 五层真正接入 CLI 启动链 + doctor effective config（E2 补充）。
5. **有界 StuckDetector** ✅：`src/harness/stuckDetector.ts` — 同一失败调用（同工具+同输入）连续 3 次在模型可见的工具结果中注入换策略提示，连续 5 次以 `stopReason: 'stuck'` 停止运行；成功或不同调用即重置；`stuckDetector: false` 显式逃生口。

Gate：fake MCP 全链路稳定、工具名零冲突、主 loop 不被 server 阻塞、warm call p95 ≤ 直接工具 1.25×。

## P2 持久化工作流与受控协作（本次不实现）

1. **Workflow DAG/状态机**：typed input/output、approval checkpoint、retry/compensation、idempotency、durable resume。Gate：恢复 ≥99%、重复副作用 0。
2. **有界 Sub-agent**：depth/concurrency/token/time/工具白名单/policy 继承/取消传播。Gate：预算 100% 终止、4 路并行加速 ≥1.5×。
3. **Hooks/LSP**：只读诊断适配器；hook 失败不得静默改变安全决策。
4. **沙箱与远程**：sandbox-runtime、可插拔 remote executor——全部 experimental flag + kill switch + fail-closed。

## 回滚

每 Loop 小步提交粒度（工作树内独立可辨）；某 Loop 引发不可定位回归 → 回退该 Loop 改动并保留测试资产；不改变默认权限语义；transcript reader 保持向后兼容。

## v1.5「真正可干活」优化（2026-09-05 启动）

> 对标 OpenCode / Claude Code / Gemini CLI / Codex CLI / Aider / mini-swe-agent 的差距分析立项（调研结论：循环不是瓶颈，提示词质量 + 工具语义 + 交互效率才是）。本轮范围：提示词重构、TUI 可用性、TodoWrite/WebFetch、AGENTS.md 项目记忆、Windows 深化、配置接线、www 复活。MCP/sub-agent/LSP/沙箱仍留 P1/P2。联调验证使用 fake LLM server（用户确认真实 API key 已失效，尽量少用真实调用）。

### Loop 8 · 基线复验 ✅（2026-09-05）
- [x] typecheck/lint 0 错；245 tests / 238 pass / 0 fail / 7 skip / 18.6s
- [x] doctor / --help 冒烟正常
- **Gate ✅**：v1.4 基线成立

### Loop 9 · 系统提示词重构（最小闭环）✅（2026-09-05）
- [x] `buildAgentSystemPrompt` 重写：身份 + `<environment>` 块（cwd/平台/OS/日期/shell/git 分支与脏文件数/模型/权限模式/边界）+ 工作纪律（理解→计划→最小改动→验证→恢复→收尾）+ 工具指南 + 沟通规范；Plan 模式专用只读纪律分支
- [x] 新增 `src/cli/envInfo.js`：环境探测（git/shell/OS/日期），单探测 2s 超时优雅降级，win32 下 Git Bash→PowerShell 顺序探测；TUI 每轮刷新、print 每次运行刷新
- [x] 六件套工具描述按「何时用/约束/输出形态」重写；Write 补齐 read-before-overwrite 强制（描述与行为一致）
- [x] 测试：`systemPrompt.test.js` 12 用例（提示词结构/环境渲染/plan 分支/探测降级/描述契约）
- **Gate ✅**：257 tests / 250 pass / 0 fail / 7 skip；typecheck+lint 0 错；真实 API 冒烟返回 401（key 失效，外部凭据问题，非代码缺陷）——重试/报错呈现/用量渲染链路验证正常

### Loop 10 · TUI 可用性升级 ✅（2026-09-05）
- [x] 新增 `src/cli/ansi.js`：零依赖 ANSI（NO_COLOR/FORCE_COLOR/非 TTY 降级；win32 由 libuv 启用 VT）；`src/cli/codeBlocks.js`：代码块提取/推断文件名/安全写盘（自 publicCliCore 下沉，避免 TUI 循环引用，语言别名扩充 python/javascript/typescript 等）
- [x] **Esc 中断**运行中的 turn（保留 Ctrl+C）；**Shift+Tab** 循环切换 plan/yolo/agent（安全梯度：agent 一键到只读 plan，yolo 需两键）
- [x] 新 slash 命令：`/model [id]`（列出+会话内切换）、`/mode [m]`、`/reasoning`（推理流显示开关）、`/save [path]`（保存最近回复代码块，复用 --write 的安全写盘）
- [x] 状态行：turn 开始显示「working — Esc/Ctrl+C to interrupt · <mode>」，首个事件自动擦除（仅 TTY）；turn 汇总行加入耗时；工具行着色（●青/✓绿/✗红/⚠黄）；排队消息提示；反斜杠续行多行输入
- [x] renderer（harnessPrint.js）接受 styler 注入，默认无色保持兼容
- [x] 测试：`tuiInteractive.test.js` 9 用例（Esc 中断、排队自动发送、Shift+Tab 循环、/model//mode//reasoning、续行、/save、状态行渲染与擦除、ansi 单元）
- **Gate ✅**：266 tests / 259 pass / 0 fail / 7 skip；typecheck+lint 0 错；既有 TUI 契约（提示/审批/排队语义）无回归

### Loop 11 · 工具补齐（TodoWrite + WebFetch）✅（2026-09-05）
- [x] **TodoWrite**（`tools/todo.ts`）：会话级任务清单，单 in_progress 约束、全量快照语义、清单渲染（☐/◐/☒）+ 摘要首行（供 preview 截断友好显示）；readOnly=true（Plan 模式可规划）；`ToolSessionState.todos` 新字段
- [x] **WebFetch**（`tools/webFetch.ts`）：仅 http/https、拒绝 URL 内嵌凭据、SSRF 防护（环回/RFC1918/链路本地/CGNAT/IPv6 站点本地 + 每跳重定向复验）、512KB 字节上限 + 15s 超时 + 取消贯穿、HTML→文本剥离与实体解码、max_chars 截断；deps 可注入（lookup/isPrivateAddress/fetchImpl）以便离线测试
- [x] 六件套 → 八件套（`tools/index.ts`）；系统提示词工具指南新增 TodoWrite 纪律与 WebFetch 使用建议
- [x] 测试：`todoWebFetch.test.js` 12 用例（清单语义/SSRF 分类器/方案与凭据拒绝/环回拒拨/HTML 剥离/真实本地 HTTP 全链路/重定向/404/取消）+ `loopToolsV15.test.js` 2 用例（openai 方言驱动 TodoWrite、anthropic 方言驱动 WebFetch 经真实循环回灌）
- [x] 修复：WebFetch 重定向目标从 location 响应头读取（原误用响应体）；既有六件套名单断言更新为八件套
- **Gate ✅**：280 tests / 273 pass / 0 fail / 7 skip；typecheck+lint 0 错；方言双链路联通验证通过

### Loop 12 · 项目记忆（AGENTS.md/ZCODE.md）✅（2026-09-05）
- [x] 新增 `src/cli/projectMemory.js`：发现链 workspace → 父目录（至多 3 层，monorepo 友好）→ `~/.zcode/ZCODE.md` 全局；每目录 AGENTS.md 优先于 ZCODE.md；单文件 8KB 截断 + 截断标注；空文件跳过；发现永不 reject
- [x] 注入：系统提示词尾部 `# Project memory` 块（`<memory source scope truncated>` 语义标注），注明「文件约定 vs 当次消息冲突时消息优先」；print 每次运行、TUI 每轮与 envInfo 并行采集
- [x] TUI `/memory`：列出已注入文件 + 作用域 + 前 5 行预览；`/help` 同步
- [x] 安全：文件名固定白名单 + `resolveInsideDir` 显式根目录约束（防御性），Mimosa 路径穿越告警经复核为误报并按建议加固
- [x] 测试：`projectMemory.test.js` 9 用例（优先级/回退/向上遍历/空文件跳过/截断/全局次序/注入位置/缺失目录降级）
- **Gate ✅**：289 tests / 282 pass / 0 fail / 7 skip；typecheck+lint 0 错

### Loop 13 · Windows 深化 ✅（2026-09-05）
- [x] **Bash 工具 shell 可选**（`resolveShellPreference`）：默认 Git Bash；`ZCODE_SHELL=powershell|pwsh` 切换 `-NoProfile -NonInteractive -Command` 方言；工具描述与 spawn 错误消息随方言动态化；进程树击杀（taskkill）语义不变
- [x] **GBK 输出解码兜底**（`decodeOutput`）：win32 下 UTF-8 解码出现 U+FFFD 时以 GB18030 重试、取损失更小者（POSIX 直通）；stdout/stderr 改 Buffer 收集后统一解码
- [x] **envInfo 报告有效 shell**：尊重 ZCODE_SHELL（探测版本并标注来源）
- [x] **doctor 强化**：转 async，新增 environment 段（平台/OS/终端类型/有效 shell/git 可用/Node 版本/transcript 目录可写/API key 仅存在性/项目记忆文件数）；清除「Legacy interactive startup is not wired」失实旧注记
- [x] **thinking_delta → reasoning_delta** 补齐（roadmap E3）：raw SSE fixture 端到端验证
- [x] 测试：`windowsV15.test.js` 9 用例（shell 选择/方言执行/解码/envInfo/doctor 无泄漏/thinking_delta）
- **Gate ✅**：298 tests / 291 pass / 0 fail / 7 skip；typecheck+lint 0 错；doctor 冒烟渲染正常

### Loop 14 · 配置接线（P1.4 落地）✅（2026-09-05）
- [x] `loadSettingsFromDisk` 接入 runCli 启动链：user → project → local → flag → policy 五层合并；解析错误 → stderr `WARNING: settings:` 且不阻断
- [x] `settings.env` 以「补缺」语义生效（真实环境与 .env 恒优先）；`applyProviderSettingsToEnv` 按 repo 既定语义应用 provider/openaiCompatible 段（含 host-managed 守护旗标）
- [x] 模型默认值链：CLI `-m` > `settings.model`；print 与 TUI 双路径生效
- [x] doctor 新增 `effectiveSettings` 摘要（键名/provider/model/baseUrl，apiKey 仅存在性），文本渲染 `effective settings:` 行
- [x] 测试：`settingsWiring.test.js` 7 用例（env 补缺/provider 段落 env/模型优先级/local 覆盖 project/坏文件降级/摘要掩码/空工作区）
- **Gate ✅**：305 tests / 298 pass / 0 fail / 7 skip；typecheck+lint 0 错

### Loop 15 · 收尾与发布（v1.5.0）✅（2026-09-05）
- [x] **`zcode www` 复活**：`wwwMain` 接入 runCli 命令分发；`www` 后旗标整体透传（parseArgv 在 www 处停止解析），全局旗标白名单不受影响；`--help` 列出 www
- [x] 真实冒烟：`zcode www --port 4399 --no-open` → 首页 HTTP 200（27,796 B）、`..%2f..%2fpackage.json` 遍历 403 拒绝、Ctrl+C 干净退出
- [x] 文档：双语 README 能力表/特性/徽章/TUI 按键说明同步 v1.5；CHANGELOG 记 v1.5.0（P0 段重记为 v1.4.1）；`package.json` → 1.5.0；lint 范围补齐 4 个新 CLI 模块（envInfo/codeBlocks/ansi/projectMemory）
- [x] 工具集事实校正：六件套 → 八件套（Read/Glob/Grep/Write/Edit/Bash/TodoWrite/WebFetch）贯穿 README/api-reference 语义
- **Gate ✅（最终）**：typecheck + lint 0 错；全量测试全绿；`--help`/`doctor`/`www` 冒烟正常；工作树留待用户审阅提交（遵循「不自动 git 提交」约定）

## v1.5 完成总结（2026-09-05）

对标调研（OpenCode 199k★ / Claude Code / Gemini CLI / Codex CLI / Aider / mini-swe-agent）→ 差距分析 → 8 个 Loop（0–7 计划编号，roadmap 记 8–15）：提示词工程化、TUI 可用性、TodoWrite/WebFetch、AGENTS.md 项目记忆、Windows 深化、配置接线、www 复活。测试 245 → 305+，全部离线可复现；真实 API 因 key 失效仅做链路验证（401 路径），后续联调全部走 fake LLM。MCP / sub-agent / LSP / hooks / 沙箱仍留 P1/P2。

## v1.5.0 真机验收（2026-09-05，真实 API：OpenAI 兼容 / glm-5.3-flash）

> 用户提供有效 key 后执行。无头部分全部完成；真机 TUI 键盘交互因用户正在使用电脑暂停（TUI 已在真实 Windows Terminal 窗口启动并确认 banner 渲染，交互验收移交用户或择期续做）。

- [x] **A 连通冒烟 ✅**：`-p "Reply with exactly: OK"` → `OK`（2.8k in / 33 out）——key/网络/计费/流式全链路通。
- [x] **B 修复任务 ✅**：预埋 2 bug 的 stringUtils（truncate 超长 + 撇号误大写，基线 3 过 2 挂），任务「修复失败测试且不得改测试文件」——agent 工具链 **Glob → Read×2 → Bash → Edit×2 → Bash**，6 轮 end_turn；实测测试 **5/5**；测试文件 mtime 未变（约束遵守）；汇报如实（逐条说明改动与验证结果）。注：3 步小任务未触发 TodoWrite，符合提示词「超过几步才用」的语义。
- [x] **C 真机 TUI ✅（完整）**：真实 Windows Terminal 窗口 + 真实键盘注入逐项验证——①Shift+Tab ×3：`mode: plan`（只读说明）→ `mode: yolo`（**黄色警告渲染正确**）→ `mode: agent`；②Agent 模式 y/N 审批真机链路：permission_request 提示 → `n` 拒绝 → `(declined)` 灰字 + 黄色 `permission denied` + 红色错误回灌模型 → 模型自行改走流式路径；③**流式中 Esc 中断**：数字流停在 3017，`turn 1 · 115.8s · in 3.2k / out 358 tok` 部分输出如实统计，`⏹ stopped — partial progress is kept in the conversation.`，会话存活可继续；④`/memory`、`/exit`（`bye — session usage in 6069 / out 1136 tok`）干净退出。附带验证：前台键盘注入的 frontmost 安全校验（游戏前台时正确拒绝注入）。用户自测与自动注入两轮交叉确认。
- [x] **D1 PowerShell 方言 ✅**：`ZCODE_SHELL=powershell` 下 Bash 工具真实执行 `Get-Location`（bash 不存在的命令）→ 返回正确 cwd。
- [x] **D2 GBK 解码 ✅**：`cmd /c echo 中文` 产出真实 GBK 字节（UTF-8 直解乱码 `�����`）→ `decodeOutput` 兜底完整恢复「中文输出测试-GBK检查」；POSIX 直通行为不变；Bash 工具内端到端中文渲染正常。
- [x] **真机验收揪出真实回归 ✅（已修复）**：`inferFilename is not defined`——Loop 2 下沉 codeBlocks.js 时 `-p` 代码块预览分支漏导入（离线测试无此覆盖）。修复导入 + 新增 `codeBlockPreview.test.js` 回归。**最终 Gate：309 tests / 302 pass / 0 fail / 7 skip；typecheck+lint 0 错。**

## v1.6.0 TUI 界面优化（2026-09-05，对标 Claude Code 实机截图）

> 用户以 Claude Code v2.x 截图为对标。全部优化在 CLI 渲染层完成（loop/types 零改动）；依赖政策放宽为「真实痛点才引入零子依赖小包」，本轮全部自写。每 Loop fake-LLM 全链路测试。

### Loop T1 · 审批 diff 预览 ✅（2026-09-05）
- [x] 新增 `src/cli/diffPreview.js`：零依赖 LCS 行 diff（Uint32 DP 表，>4000 行降级）+ 上下文折叠裁剪 + Edit/Write 审批预览构建器
- [x] TUI `askApproval`：Edit（old/new 直接 diff、replace_all 注记）/ Write（覆写 diff 磁盘旧内容、新文件头部 30 行）→ 红/绿/灰着色 diff 头 `Edit → file (edit · +N −M)`；print TTY 审批同步
- [x] 测试 16 用例（算法/裁剪/审批构建/TUI 集成含文件落盘验证）
- **Gate ✅**：325 tests 0 fail

### Loop T2 · TodoWrite 清单渲染 ✅（2026-09-05）
- [x] TUI `tool_execution_start` 特判：从 `input.todos` 渲染完整着色清单（☒绿/◐青/☐灰），`tool_execution_end` 仅显示摘要行——替代 160 字符截断
- [x] 测试 2 用例（清单渲染/畸形输入回退）
- **Gate ✅**：327 tests 0 fail

### Loop T3 · 流式 markdown ✅（2026-09-05）
- [x] 新增 `src/cli/markdownStream.js`：**纯数据解析器**（text_delta → {fence-open|fence-close|line, segments}）——跨 delta 拼行、代码围栏状态机（未闭合 flush 自动关）、`**bold**`/`` `code` ``/标题行 styled segments
- [x] TUI 接入：有色 TTY 走解析器渲染（围栏框线 + 着色 segments），无色/非 TTY 直通；assistant_message 与 finally 双点 flush
- [x] 测试 11 用例（拼行/围栏/样式/幂等/TTY 集成/直通）
- **Gate ✅**：338 tests 0 fail。附注：Mimosa 对「正则捕获组参与拼接」误报命令注入 ×6，最终以纯数据架构通过（渲染/逻辑分离，更可测）
- **Gate ✅**：338 tests 0 fail

### Loop T4 · 输入补全 ✅（2026-09-05）
- [x] 新增 `src/cli/completer.js`：readline completer——`/` 补全 11 命令；`@` 补全工作区文件（浅层遍历跳 node_modules/.git/dist 等、2000 文件/深度上限、30s 缓存、50 条截断）
- [x] TUI createInterface 接线 + historySize 200
- [x] 测试 5 用例（命令/@文件/缓存/降级）
- **Gate ✅**：343 tests 0 fail

### Loop T5 · spinner 状态行 ✅（2026-09-05）
- [x] 状态行动画：`WT_SESSION` 探测 → Braille 帧 / legacy conhost → ASCII 帧；已用秒数实时刷新（120ms interval）；首个可见事件与 turn 结束双点严格清理 interval
- **Gate ✅**：343 tests 0 fail

### Loop T6 · Claude Code 式外观 ✅（2026-09-05）
- [x] 新增 `src/cli/tuiChrome.js`（纯函数）：像素 Z banner（logo+版本/模型/cwd 三行）、`[model] | dir git:(main*) | Context ▓▓░░░░░░░░ N%` 状态行（git 状态来自 envInfo，Context 按模型族窗口表估算、未知 128k 兜底）
- [x] TUI banner 替换 + 每轮 usage 汇总后输出状态行
- [x] 测试 5 用例（窗口表/banner/进度条/状态行/TUI 集成）
- **Gate ✅**：348 tests / 341 pass / 0 fail / 7 skip；typecheck+lint 0 错（lint 范围已含 4 个新模块）

### Loop T7 · 收尾 ✅（2026-09-05）
- [x] CHANGELOG v1.6.0、双语 README TUI 段更新、lint 范围补 diffPreview/markdownStream/completer/tuiChrome
- [x] **最终 Gate：349 tests / 342 pass / 0 fail / 7 skip；typecheck+lint 0 错**
- [x] **真机截图验收 ✅（真实 API + 真实终端逐帧取证）**：①像素 Z banner（青色块字符 + 版本/模型/cwd 三行）上屏正确；②TodoWrite 着色清单三次状态推进（◐青/☐灰/☒绿 + 绿色摘要行）；③**diff 审批预览真机首秀**：`Edit → greeting.txt (edit · +1 −1)` 红 `- hello world` / 绿 `+ hi world`，y 批准后实际落盘；④行内样式（`**hi**` 粗体、`` `type` `` 青色行内码）渲染生效；⑤**Claude Code 式状态行上屏**：`[glm-5.3-flash] | greet | git:(main*) | Context ▓░░░░░░░░░ 13%`；⑥`/exit` 干净退出
- [x] **真机验收揪出围栏 bug ✅（已修复）**：模型输出不规范围栏 `​```txthi world`（内容胶连 info string 同行）被开栏检测整行吞掉——修复：开栏收紧为「```(+语言标签)+行尾」，非标准围栏行与其后配对的裸 ``` 按字面原样渲染（内容零丢失），补 3 用例回归。**修复后 Gate：349 tests / 342 pass / 0 fail / 7 skip**

## v1.7 CLI/TUI 对标打磨（2026-09-06 启动）

> 范围限定 CLI 与 TUI；firecrawl/文档调研 Claude Code 交互模式与 OpenCode 键位后选型（Firecrawl key 失效，改用 WebFetch）。零新依赖，fake-LLM 全链路测试。后续 Loop 候选（按价值排序）：`/resume` 会话内选择器、Ctrl+R 历史反查、`Up` 召回排队消息、`#` 记忆追加模式。

### Loop C1 · Shell 直通 + 工具输出复核 + 终端呈现 ✅（2026-09-06）
- [x] **`!` shell 模式**：`! <command>` 经 Bash 工具同一执行器（输出解码/超时/进程树击杀一致）直接运行——用户击键即意图，无审批门；命令+输出作为下一条 user 消息注入并由模型立即响应（Claude Code 语义）。空 `!` 给用法提示。
- [x] **Ctrl+O 工具输出展开**：现场渲染 160 字符截断，loop 的 executedCalls 保留完整结果——Ctrl+O（空闲时）打印最近一次工具调用的完整输出（展示上限 8KB + 余量注记）。
- [x] **终端标题 + 完成响铃**：turn 开始设窗口标题 `● <prompt> — ZCode`（切窗可见长任务），结束恢复 `ZCode — <cwd>`；响铃仅对 ≥10s 的长回合触发（Esc 用户已在键盘前，不扰民）。仅 TTY 生效。
- [x] 测试：`!` 直通全链路（命令回显/输出打印/进模型上下文/空 `!` 不耗轮次）、Ctrl+O 展开 300 字符 Read 输出、TTY 标题序列设置与恢复。共享 stub 补 toolCalls 支持（加法）。

### Loop C2 · Esc Esc 消息回退（rewind）✅（2026-09-06）
- [x] **空闲双击 Esc（≤800ms）**：回退最近一条 user 消息及其后全部交换，原文放回编辑器（TTY 经 `rl.write`，非 TTY 打印还原预览）；更早历史保留。仅内存态——transcript 仍含完整交换，resume 该会话文件可还原（已注明）。
- [x] 单 Esc 空闲时保持无操作（仅记录时间戳）；运行中 Esc 仍是中断。
- [x] 测试：双 Esc 回退 + 断言下一轮请求含 earlier、不含 rewound 交换。

- **Gate ✅（2026-09-06）**：typecheck + lint 0 错；全量 **433 tests / 425 pass / 0 fail / 8 skip**；tuiInteractive 13/13。/help 同步全部新键位与 `!` 语义。
