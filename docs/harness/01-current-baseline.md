# 01 当前基线（v1.4.0）

> Status: evidence + normative（数据段为实测留档） · Owner: harness maintainers
> Last verified: 2026-09-05（HEAD `3f98d76`，Windows 10.0.26100 / Node v24.14.0 / Git Bash）

## 实测基线（Loop 0，2026-09-05）

| 检查 | 命令（cwd=`ZCode/`） | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | ✅ 0 error |
| Lint | `npm run lint` | ✅ 0 error |
| 测试套件 | `npm test` | ✅ 219 tests：214 pass / 0 fail / 5 skip / 28.6s |
| CLI 冒烟 | `node src/entrypoints/publicCli.js doctor --json` | ✅ v1.4.0、node v24.14.0、`anthropic:firstParty`、printReady=true、11 models |
| CLI 冒烟 | `models --json` | ✅ 返回模型描述符数组 |

**已知抖动**：`test/harness/bashPolicy.test.js` 的 loop 集成用例会真实执行 `npm install`（历史记录：网络不畅时该用例执行约 316s 后失败）。本次通过不代表它确定性——P0-A 必须将其注入化（见 roadmap）。

## 运行时事实

- 唯一入口：`ZCode/src/entrypoints/publicCli.js` → `src/cli/publicCliCore.js`（`-p` headless / TUI / 子命令）
- 循环核心：`src/harness/loop.ts`（Think→Act→Observe，AbortSignal，pre-output retry，transcript）
- 依赖：运行时仅 `picomatch`；Node ≥ 24 原生类型剥离，零构建
- 包脚本：`start/dev/doctor/models/typecheck/lint/test`（见 `ZCode/package.json`）

## 模块状态表

| 模块 | 路径 | 状态 |
|---|---|---|
| Agent 循环 | `src/harness/loop.ts` | ✅（含 P0-B 待修项） |
| 消息/事件类型 | `src/harness/types.ts` | ✅ |
| 双方言翻译 | `src/harness/translate.ts` | ✅ |
| 权限门 | `src/harness/permissions.ts` | ✅ Plan/Agent/YOLO，fail-closed |
| Bash 策略 | `src/harness/bashPolicy.ts` | ✅ allow/deny/ask（非 sandbox） |
| 工作区边界 | `src/harness/boundary.ts` | ✅ 词法 containment（P0-C 升级 realpath） |
| 护栏 | `src/harness/guardrails.ts` | ✅ maxTurns=30 默认 + budgetTokens |
| 转录 | `src/harness/transcript.ts` | ✅ JSONL 串行 append（P0-D 加固） |
| 压缩 | `src/harness/compact.ts` | ✅ 100k 阈值 / 保留 6 条 |
| 恢复 | `src/harness/resume.ts` | ✅（P0-D 收紧 Read 播种） |
| 六件套工具 | `src/harness/tools/` | ✅（P0-B/C 补 signal/预算） |
| Provider ×2 | `src/providers/openaiCompatible.js`、`anthropic.js` | ✅ SSE/tool delta/retry |
| CLI | `src/cli/publicCliCore.js`、`harnessPrint.js`、`tui.js` | ✅（P0-E 修 plan+write） |
| 配置契约 | `src/config/settingsContract.js`、`providerEnvironment.js` | ⚠️ 存在但 CLI 未接线（P0-E） |

## 已确认的高优先级缺陷（P0 输入清单）

按修复顺序（与 roadmap Loop 对应）：

| # | 缺陷 | 代码位置 | Loop |
|---|---|---|---|
| A1 | bashPolicy 集成测试真实执行 `npm install`，网络依赖 + 最长 316s | `test/harness/bashPolicy.test.js` | P0-A |
| B1 | `consumeTurn` 在 abort/EOF 时仍返回 outcome，可能被外层判为 `end_turn` | `loop.ts:516-565` | P0-B |
| B2 | Bash 不监听 `context.signal`，Ctrl+C 无法终止运行中的 shell；无进程树 kill | `tools/bash.ts:44-99` | P0-B |
| B3 | Glob/Grep 未向 `walkFiles` 传 signal | `tools/glob.ts:36`、`grep.ts:158` | P0-B |
| B4 | provider 重试（默认 2）与 loop 重试（默认 3）叠加，单轮最坏 9 次请求，无共享 deadline | `openaiCompatible.js:284`、`anthropic.js:188`、`loop.ts:45-48` | P0-B |
| B5 | loop backoff `setTimeout` 不响应 signal | `loop.ts:374-375` | P0-B |
| C1 | boundary 仅词法 normalize/relative，symlink/junction 可越界 | `boundary.ts:41-48` | P0-C |
| C2 | `fsWalk` 无 symlink cycle 防护、无字节/时间预算；路径为文件时静默空结果 | `tools/fsWalk.ts` | P0-C |
| D1 | resume 按 assistant 意图（历史 `Read` 调用名）播种 `readFiles`，失败的 Read 也被当作已读 → Edit 绕过 read-before-edit | `loop.ts:480-497`、`resume.ts:169-183` | P0-D |
| D2 | transcript 写失败被静默吞掉（仅 flush 时抛出且被 loop 捕获丢弃） | `transcript.ts:75-80`、`loop.ts:455-459` | P0-D |
| D3 | transcript 无敏感值 redaction（明文记录 prompt/工具输入输出） | `transcript.ts` | P0-D |
| E1 | `--plan --write` 组合：工具写入被拒，但 CLI 后处理仍把 Markdown 代码块落盘，违背 Plan 零写入 | `publicCliCore.js:667-676, 979-985` | P0-E |
| E2 | TUI 恢复链路未传 resume 元数据（不重建 Read 状态、transcript 缺 `resumedFrom`） | `publicCliCore.js:767-800`、`tui.js:144-160` | P0-E（随 D 记录） |
| E3 | Anthropic `thinking_delta` 未映射为 `reasoning_delta` | `anthropic.js:367-385` | P1 记录 |
| E4 | 文档漂移：implementation-status §4 与 v1.4 实现矛盾、api-reference 版本/Anthropic Print/messageId 过时 | `docs/implementation-status.md`、`docs/references/api-reference.md` | P0-E |

## 文档漂移处置

`docs/implementation-status.md`、`docs/references/api-reference.md`、根 README 徽章：在 P0-E 按本目录 normative 文档校正；`docs/plans/`、`系统设计说明书.md`、`requirements-analysis.md`、`ZCode_SRS.docx` 标记 historical（映射见 [requirements-to-capability.md](./requirements-to-capability.md)）。
