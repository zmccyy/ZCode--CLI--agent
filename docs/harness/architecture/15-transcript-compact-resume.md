# 15 Transcript、Compact 与 Resume

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05（v1.4.0）
> Code refs: `ZCode/src/harness/transcript.ts`、`compact.ts`、`resume.ts`、`loop.ts`（session_start/resumed/compact 记录）
> Test refs: `test/harness/compact.test.js`、`resume.test.js`

## Transcript 的地位

**Transcript 是恢复与审计的事实源，不是 debug 日志。** 两个推论：

1. 恢复逻辑只允许从 transcript 的**执行事实**重建状态（见下文 resume 规则）。
2. 写失败必须可见（当前静默吞掉是缺陷 D2，P0-D 修复）。

## 记录类型（当前实现）

| type | 内容 |
|---|---|
| `session_start` | sessionId、cwd、model、permissionMode、provider、dialect、boundary、resumedFrom? |
| `message` | canonical 消息（恢复主来源）；restored 标记回放历史 |
| `turn_start` / `turn_end` | 轮边界 + usage |
| `tool_execution_start` / `tool_execution_end` | 工具调用审计（含 isError、durationMs） |
| `permission_denied` | 拒绝审计（工具、输入、理由） |
| `usage` | 每轮 usage + finishReason |
| `context_compact` | 压缩审计（含摘要文本） |
| `guardrail` / `error` / `provider_retry` | 护栏/错误/重试 |
| `result` | 终态：stopReason、turns、usage、error |

## P0-D 目标契约

1. **schema version**：`session_start` 增加 `schemaVersion`；旧文件 reader 保持兼容；新字段只做向后兼容扩展。
2. **写失败可见**：flush 失败 → `AgentLoopResult` 增加 `warnings[]`（或 error 字段承载），CLI/TUI 输出提示；禁止伪装为完整持久化。
3. **redaction**：append 前对已知密钥模式（`sk-…`、`Authorization: …`、`x-api-key: …`）做占位替换；占位格式 `[REDACTED]`。规则在 operations/52 维护。
4. **半行容错**：reader 跳过无法解析的最后一行并计数（现状逐行容错已覆盖，补崩溃恢复回归测试）。
5. **存储位置与权限**：`~/.zcode/projects/<sha256(cwd)>/<sessionId>.jsonl` 不变；文档登记保留/清理策略（operations/53）。

## Compact 契约（当前实现 = 契约）

- 触发：上一请求 provider 上报 inputTokens ≥ `ZCODE_COMPACT_TOKENS`（默认 100k；0 关闭）。
- 保留尾部：默认 6 条；**边界绝不落在悬空 tool result 上**（回退到其 assistant 轮，`selectCompactionBoundary`）。
- 摘要请求：无 tools、无 system；usage 计入会话总账。
- 失败尽力而为：不压缩继续跑，事件+transcript 如实记录；同轮不重复尝试（compactionExhausted / MAX_COMPACTION_ATTEMPTS=5）。
- **P1 升级方向**（结构化 memento，Codex CLI/OpenHands 对标）：摘要 prompt 固定 schema——USER_CONTEXT / GOAL / ACCEPTANCE_CRITERIA / PLAN（原文）/ COMPLETED / PENDING / CODE_STATE（路径+符号）/ TESTS / CHANGES / DEPS / VERSION_CONTROL_STATUS / BLOCKERS / BUDGET。压缩在硬上限前留安全余量触发。

## Resume 规则

现状（`resume.ts` + `loop.ts` session 恢复段）：

- `--continue` 续最近会话；`--resume <id|path>`；`sessions` 列表；坏行跳过计数；无消息拒绝恢复。
- 恢复历史原样写入新 transcript（自包含、可链式恢复）；`session_start` 记 `resumedFrom`。
- 相对路径按**原始 cwd**解析（跨目录恢复不得错误标记已读——已有测试锁定）。

**P0-D 修复（缺陷 D1）**：`readFiles` 播种只信任**成功执行**的 Read——即 transcript 中存在对应 `tool_execution_end` 且 `isError: false` 的调用；仅凭 assistant `toolCalls` 意图不播种。等价地：transcript 为每次成功 Read 增加显式可关联标记（toolCallId 关联），恢复时重建。

- 直接传入 transcript 路径（`resolveSessionPath`）允许，但跨 workspace 恢复时按原始 cwd 语义处理并在输出中提示。
- 中断/guardrail/error 终止的 transcript 均可恢复。

## Failure semantics

| 场景 | 行为 |
|---|---|
| 最后一行为半行 JSON | 跳过 + 计数，不影响前面的历史 |
| 无任何 message | 拒绝恢复，非零退出 |
| compact 摘要为空/失败 | 继续不压缩，事件可见 |
| transcript 目录不可写 | loop 正常完成但结果带 warning（P0-D），CLI 打印 stderr 提示 |
