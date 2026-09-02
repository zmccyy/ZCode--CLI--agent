# Changelog

## 1.1.1 — 2026-09-02

可靠性补丁 + 工程化基线：重试对称化、恢复安全修复、push/PR CI、strict 类型与 lint、仓库清理。

### Reliability

- **OpenAI 兼容 provider 重试**（`src/providers/openaiCompatible.js`）：429/5xx 与网络错误按指数退避重试（默认 2 次，`maxRetries` 可配；`retry-after` 响应头优先），与 Anthropic 侧对齐 —— 此前主力路径（DeepSeek）遇到限流直接终局。
- **循环内 provider 重试**（`src/harness/loop.ts`）：轮次请求在**任何输出流出之前**失败时自动重试（默认共 3 次尝试，`providerRetry.attempts` / `providerRetry.backoffMs` 可调，指数退避上限 8s），重试不消耗护栏轮数；已流式输出的轮次**绝不重放**（避免重复输出），失败如实终局。新增 `provider_retry` 循环事件与转录条目，文本模式打印重试提示行。
- **修复：跨目录恢复会话的 read-before-edit 旁路**（`src/harness/loop.ts`）：恢复历史中的相对路径 Read 此前用**当前** cwd 解析，在另一个目录 `--resume` 时会把本地同名未读文件标记为"已读"，Edit 可直接改动从未看过的内容。现在通过 `resume.originalCwd`（转录记录的原会话 cwd）解析，跨目录恢复时同名文件必须重新 Read 才能编辑。

### Engineering

- **push/PR CI**（`.github/workflows/ci.yml`）：Windows + Node 24，每次 push/PR 跑全量测试（874 项）+ `tsc --noEmit`（公共层 **strict: true**）+ ESLint（核心规则 + typescript-eslint recommended，仅公共层）。README 增加徽章。
- **公共层类型收紧**：`tsconfig.public.json` 开启 `strict`；`usage.ts` 空值处理显式化；接入 `@types/picomatch`。
- **死代码清理**：移除未使用的导入/参数/常量（`buildAgentSystemPrompt` 导入、`showReasoning` 死参数、`requireString`、`BRIDGED_PROVIDER_ENV_KEYS` 等），为有意为之的拒绝性生成器与测试桩补充 lint 豁免注释。

### Repository hygiene

- untrack 误提交的根目录 `node_modules/`（387 个文件，磁盘保留，.gitignore 已生效）。
- 移除 `ZCode-作业提交.zip`（10 MB；仅从当前提交移除，历史中仍可找回）。
- 新增 `ZCode/src/README.md`：声明公共层与遗留参考树的边界、非产品代码警告与移除时间表（v1.4）。
- 重写 `docs/implementation-status.md`：以 harness 为主线反映 v1.1.1 真实状态（原内容停留在 6 月的参考树视角，与现状矛盾）。

### Compatibility notes

- `runHarnessPrint` 移除未被使用的 `showReasoning` 参数（reasoning 展示仍由 `--reasoning` + 进度渲染器处理，调用方不受影响）。
- `providerEnvironment.js` 移除未导出的 `BRIDGED_PROVIDER_ENV_KEYS` 常量（无任何引用）。
- 循环新增可选 `providerRetry` 选项，默认开启（3 次尝试）；需要旧行为（失败即终局）可传 `providerRetry: { attempts: 1 }`。

## 1.1.0 — 2026-09-01

Harness v1.1：长任务不丢上下文、断线可续 —— 自动上下文压缩与会话恢复。

### Highlights

- **自动上下文压缩**（`ZCode/src/harness/compact.ts`）：provider 上报的上一请求 input tokens 达到阈值（默认 100k，`ZCODE_COMPACT_TOKENS` 可调，0 关闭；`ZCODE_COMPACT_KEEP_MESSAGES` 控制保留条数，默认 6）时，用一次**无工具、无 system** 的模型请求把较早历史摘要化，替换为摘要消息 + 最近 N 条原文。压缩边界保证不产生悬空 tool_result（Anthropic 角色交替约束）；摘要 usage 计入会话总账；失败或空摘要时**不压缩继续跑**，事件与转录如实记录。`--json` 信封新增 `compactions` 字段。
- **会话恢复**（`ZCode/src/harness/resume.ts`）：`zcode -p "…" --continue` 续接本工作区最近会话，`--resume <sessionId|path>` 指定会话，`zcode sessions` 列出历史会话（`--json` 可机读）。恢复时从转录重建消息历史与 Read 前置状态——Edit/Write 的 read-before-edit 约束在续会话中依然成立；新会话把恢复的历史写入自己的转录（自包含、可链式恢复），`session_start` 记录 `resumedFrom`。转录逐行容错解析，损坏行跳过并计数。
- **转录完整性**：会话首条 user 提示词现在也落盘（此前未记录，恢复会丢失原始任务）；`--json` 信封在续接时新增 `resumedFrom`。
- **Anthropic 方言加固**：紧跟 tool_result 用户轮的纯文本 user 消息（如压缩指令）并入同一用户消息，满足角色交替要求。
- **CI 现代化**：Release 工作流升级 `actions/checkout@v5`、`actions/setup-node@v5`（Node 24）、`softprops/action-gh-release@v3`，消除 GitHub Actions 的 Node 20 运行时弃用告警。

### Compatibility notes

- 转录条目序列变化：`session_start` 之后现在先记录种子/恢复的消息再进入轮次条目；读取转录的脚本若假定固定序列需注意。
- `zcode sessions` 为新增子命令；命令清单（`toCommandList`）相应扩展。

## 1.0.0 — 2026-08-31

Harness v1：ZCode 从单轮问答升级为真正的终端 Agent 运行时。

### Highlights

- **Agent 循环**（`ZCode/src/harness/loop.ts`）：provider 无关的多轮 Think→Act→Observe 循环 —— 流式收模型响应、权限门、执行工具、结果回灌，直到模型停止调用工具或护栏触发。
- **核心六件套工具**：Read（cat -n 行号、分页、二进制检测）、Glob（mtime 排序、噪音目录剪枝）、Grep（正则、files/content/count 模式、上下文行）、Write（mkdir -p）、Edit（唯一匹配精确替换、read-before-edit 强制）、Bash（Git Bash `bash -c`、超时、退出码、输出截断）。
- **权限门三模式**：Plan（只读探索，写入被拒并反馈给模型）/ Agent（TTY 下逐调用 y/n，管道输入 fail-closed）/ YOLO（全自动）。
- **护栏**：默认最多 30 轮（`--max-turns` / `ZCODE_MAX_TURNS`）与累计 token 预算（`ZCODE_BUDGET_TOKENS`）；触发即硬停并如实汇报已执行进度。
- **JSONL 会话转录**：默认落 `~/.zcode/projects/<cwd-hash>/<sessionId>.jsonl`，可用 `ZCODE_TRANSCRIPT_DIR` 覆盖。
- **`--json` 信封向后兼容扩展**：新增 `toolCalls[]`（含执行结果与耗时）、`usage`、`stopReason`、`turns`、`sessionId`、`runMode`。
- **双 provider 方言**：同一循环同时驱动 OpenAI 兼容流（DeepSeek）与 Anthropic SSE 流。
- **测试基建**：剧本式假 LLM 服务器（`test/helpers/fakeLlmServer.js`，双方言）驱动真实循环 + 真实工具；live e2e 无 key 自动跳过。

### Acceptance

- UC-03「修复所有失败的测试」在 DeepSeek（`deepseek-v4-flash`）上无人工干预真实通过：Bash → Glob → Read → Bash(观察失败) → Edit×2 → Bash(验证通过) → 如实汇报。证据：[docs/acceptance/](docs/acceptance/)。

### Compatibility notes

- `-p` 现在驱动完整 Agent 循环（此前为单轮问答）；请求体会包含 system 提示与六件套工具定义。
- `--plan` 从占位提示变为真实只读循环。
- Anthropic provider 现在被视为 print-ready（doctor 的 `printReady` 相应变化）。
- 文本模式下最终回答仅流式输出一次（不再在页脚重复打印）。

## 0.1.0 — 2026-06

- 公共 CLI：`help` / `doctor` / `models` / 单轮 `-p` 打印模式（含 `--json`、`--write`、`--reasoning`）。
- 双 provider 流式对话层（OpenAI 兼容 + Anthropic），统一 `tool_call` 流事件契约。
