# 23 CLI、JSON 与配置契约

> Status: normative · Owner: CLI maintainers · Last verified: 2026-09-05（v1.4.0）
> Source of truth: `ZCode/src/cli/publicCliCore.js`（argv 解析 327-472、命令分发）、`harnessPrint.js`（JSON envelope）
> Test refs: `test/publicCli.test.js`、`test/harness/cliPrint.test.js`、`test/runModes.test.js`

## 命令与选项（以 publicCliCore.parseArgv 为准）

| 项 | 说明 |
|---|---|
| `-p, --print <prompt>` | 无头 Agent 循环 |
| `--json` | 机器可读输出（-p / doctor / models / sessions） |
| `-m, --model <id>` | 指定模型 |
| `--plan` / `--yolo` | 权限模式（互斥，同时传入回退 agent + WARNING） |
| `--max-turns <n>` | 覆盖默认 30 |
| `--continue` / `--resume <id\|path>` | 会话恢复（互斥） |
| `--add-dir <dir>` | 追加文件工具可信根（可重复） |
| `--no-boundary` | 解除工作区边界（显式逃生） |
| `--reasoning` | 流式展示推理 |
| `-w, --write [path]` | **后处理写入 Markdown 代码块**（见下 P0-E 裁决） |
| 子命令 | `help / doctor / models / sessions` |

**P0-E 裁决（缺陷 E1）**：`--plan` 与 `--write` 组合**立即拒绝**（参数错误，非零退出）——Plan 模式承诺零写入，包括 CLI 后处理路径。回归测试锁定。

## `--json` envelope（-p）

稳定字段（冻结）：

```json
{
  "provider": "…", "model": "…",
  "text": "最终文本",
  "toolCalls": [ { "toolCallId": "…", "name": "…", "input": {}, "result": "…",
                    "isError": false, "durationMs": 0 } ],
  "stopReason": "end_turn | max_turns | budget_exceeded | aborted | error",
  "turns": 1, "usage": { "inputTokens": 0, "outputTokens": 0, "totalTokens": 0 },
  "compactions": 0,
  "finishReason": "stop | tool_call | … | null",
  "error": null,
  "sessionId": "…", "runMode": "plan | agent | yolo", "resumedFrom": "…| null"
}
```

规则：
1. **stdout 只承载 JSON**；诊断/进度走 stderr（`--json` 下）。
2. 新字段只增不改；`messageId` 现状恒为 null（非 provider 响应 ID）——P1 要么移除要么接真实值，使用方不得依赖。
3. `error` 非空时携带分类 code（architecture/13）。
4. P1 预留 `warnings[]`（transcript 写失败等）与 `status`（contracts/24）。

## 退出码

| 场景 | 退出码 |
|---|---|
| 成功（含 partial 报告） | 0 |
| 用法/参数错误（含 plan+write 冲突） | 2 |
| provider 错误 / 循环 error | 1 |
| 用户取消（aborted） | 130 |
| 护栏终止（max_turns/budget） | 3 |

## 配置层级（settingsContract.js 存在、P0-E 接线）

优先级（后覆盖前）：`user < project < local < flags < policy`（`SETTINGS_SOURCE_PRIORITY`）。

- `policy`（managed）不可被低层覆盖；无效 JSON 对用户可见，policy 文件损坏不静默跳过。
- API key 不进项目 settings（进 env / user 层）。
- P0-E 目标：CLI 启动链调用 `loadSettingsFromDisk` + `createProviderFromSettings`，`doctor` 输出 effective config（来源标注）；未接线前 settingsContract 相关声明在文档中标注“契约已定、接线未完成”。

## `.env` 规则（现状契约）

cwd 优先读 `.env`；已存在的 env 不覆盖；支持 `#`注释、`export`、引号。环境变量全集见 api-reference（P0-E 校正后）。
