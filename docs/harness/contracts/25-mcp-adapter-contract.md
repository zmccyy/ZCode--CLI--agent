# 25 MCP stdio 适配器契约（最小子集）

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-06（P1.3 已实装）
> Source of truth: `ZCode/src/harness/mcpClient.ts`（传输/协议/进程生命周期）+ `ZCode/src/harness/mcpTools.ts`（配置解析/发现/工具适配）
> Test refs: `test/harness/mcp.test.js`（15 用例：解析/发现/全链路/权限/超时/崩溃重连/预算/wiring）、`test/settingsContract.test.js`（mcpServers 归一化）

## 范围（P1.3 最小子集，刻意收窄）

- 传输：stdio，newline-delimited JSON-RPC 2.0。
- 协议方法：`initialize` 握手 + `notifications/initialized`、`tools/list`（跟随 cursor）、`tools/call`、`notifications/cancelled`（中止/超时时 best-effort 发送）。
- 不做（明确排除）：server→client 请求（sampling/roots elicitation）、`notifications/tools/list_changed` 及一切 server 通知（收到即忽略；重连沿用会话开始时发现的工具清单）、resources/prompts、HTTP/SSE 传输、OAuth。

## 启动器边界（v1）

- 服务器必须是 **Node 脚本**：`spawn('node', [script, ...args], { shell: false })`。程序固定为字面量 `node`；配置只提供脚本路径与参数，按 argv 数组逐字传递，不经 shell 解析（与 tools/bash.ts 同型）。
- `script` 必须是 `.js/.mjs/.cjs`；相对路径相对 cwd（工作区根）解析。
- **任意可执行文件（uvx/python/docker/npx…）→ P2**，需与项目安全策略的二进制白名单（`.mimosa/security-policy.json` 的 `command.allowedBinaries`）集成后开放。此边界是安全决策，不是能力缺陷。

## 配置（settings `mcpServers`，默认关闭）

```json
{
  "mcpServers": {
    "<serverName>": {
      "script": "./tools/my-server.mjs",
      "args": ["--flag"],
      "env": { "KEY": "value" },
      "timeoutMs": 30000,
      "enabled": true
    }
  }
}
```

- **默认关闭**：无配置 = 零进程、零行为；`enabled: false` 为显式 kill switch（静默跳过，不告警）。
- settingsContract 层只做形状归一化（形状保留）；语义校验在 `parseMcpServers`，每个被跳过的 server 产生一条精确 warning（`WARNING: mcp: …`），坏配置永不阻断会话。
- serverName：`^[A-Za-z0-9_-]+$`；单会话 server 上限 16（按名称排序截断并告警）。

## 命名双形（contracts/22 namespace 字段的落地语义）

| 形式 | 形状 | 用途 |
|---|---|---|
| registry name | `mcp__<server>__<tool>` | 工具注册名/模型可见名。**线协议安全形**：OpenAI/Anthropic 的工具名文法只接受 `[A-Za-z0-9_-]`，点号会被真实 API 拒绝（即 Claude Code 式双下划线） |
| namespace 字段 | `mcp.<server>.<tool>` | contracts/22 冻结的点号形式，落在 `ToolDefinition.namespace` |

- 重名守卫：发现层按 registry name 去重，冲突者跳过并告警——registry 的唯一性不变量（contracts/22 不变量 1）永不因 MCP 配置而抛错。

## 信任与权限姿态（contracts/22 MCP 对齐备注的落地）

- **wire annotations 是 untrusted hints**：一切 MCP 工具注册为 `readOnly: false`（Agent 模式逐次审批、Plan 模式拒绝、YOLO 自动放行）。readOnlyHint 不被信任。
- **统一入口不变量 3**：MCP 工具与内置工具走同一条 registry → permission → boundary → transcript 路径，无旁路执行；transcript 事件即审计轨迹。
- 契约声明：`cancellable: true` + `timeoutMs`（服务器配置，默认 30s、上限 600s）+ `outputLimitBytes`（256KB）——由 loop 的 P1.1 机制强制（per-call AbortController、字节级截断）。错误码映射见下。

## 失败语义（错误码词表映射）

| 情形 | ToolResult | code |
|---|---|---|
| 服务器业务失败（`result.isError: true`） | 内容原样回灌 | 无（"失败即结果"） |
| loop 死线到（P1.1 强制） | loop 消息 | `timeout` |
| 传输层请求超时（客户端背停，死线+1s） | 适配器消息 | `timeout` |
| 用户取消（外层 signal） | 含 "aborted" | `aborted` |
| 服务器崩溃 / spawn 失败 / JSON-RPC error | 含退出码与 stderr 尾部（≤400 字符） | `failed` |
| 重连预算耗尽 / 已 dispose | 永久不可用消息 | `failed` |

## 进程生命周期

- **发现**：会话启动时逐 server 连接（握手超时默认 10s）+ tools/list；失败降级为 warning，不阻断。`-p` 路径在 run 结束、TUI 路径在会话结束时 `dispose()`（杀子进程 + 清 exit hook）。
- **每请求死线**：超时先发 `notifications/cancelled` 再拒绝；loop 级死线是权威，客户端超时（+1s 背停）只保护绕过 loop 的直接注册表调用。
- **崩溃**：常驻 exit/error 监听——立即标记不可用、拒绝全部挂起请求（kind 语义保真：传输失败 ≠ JSON-RPC error）；**下一次调用**触发有界重连（respawn + 重新握手，预算默认 2 次/client），预算耗尽后该 server 本会话禁用（明确报错，不无限重试）。
- **健壮性**：stderr 有界尾随（8KB，永不阻塞子进程）；stdout 非 JSON 行/超长行计数并跳过；孤儿防护：`process 'exit'` hook 兜底杀子进程。
- **主 loop 不被阻塞**（Gate）：发现死线化、每调用死线化、崩溃即时失败——server 永远不能挂住轮次。

## 协议版本

请求 `2024-11-05`；握手接受 `2024-11-05 / 2025-03-26 / 2025-06-18`，其余版本明确拒绝（fail-fast）。
