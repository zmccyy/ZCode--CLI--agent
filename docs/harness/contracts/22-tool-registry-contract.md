# 22 工具注册与执行契约

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-06（v1.7.0，P1.1 已实装）
> Source of truth: `ZCode/src/harness/types.ts`（ToolDefinition/ToolContext/ToolSessionState）+ `tools/registry.ts`
> Test refs: `test/harness/tools.test.js`、`test/harness/m2Security.test.js`、`test/harness/toolContract.test.js`

## ToolDefinition（当前 = 契约）

```ts
{
  name: string                     // 全局唯一（registry 保证）
  description: string              // 进入模型上下文，写清楚语义与限制
  inputSchema: JsonSchemaObject    // 当前为"描述性 schema"（P1 升级为 runtime 校验）
  readOnly: boolean                // 决定 Plan/Agent 权限行为
  execute(input, context): Promise<ToolResult> | ToolResult
}
```

## ToolContext

```ts
{
  cwd: string
  state: { readFiles: Set<string> }   // 会话级 read-before-edit 状态
  signal?: AbortSignal                // 取消；工具必须尊重（P0-B 起）
  boundary?: WorkspaceBoundary        // 文件工具可信根；loop 默认注入
}
```

## 注册表不变量

1. **名字唯一**：`createToolRegistry` 拒绝重名。
2. **未知工具可恢复**：返回 model-visible 错误并列出可用工具（loop 已实现）。
3. **统一入口**：任何工具（内置/未来 MCP）必须经过 registry + permission + boundary + transcript，禁止旁路执行。
4. **失败即结果**：业务失败用 `isError: true` 返回；抛异常由 loop 兜底转错误结果（工具不应依赖异常表达业务语义）。
5. **取消**：被 signal 中断 → `isError: true` + 内容含 `aborted`（P0-B）。

## Schema 校验路线（P1）

现状：`inputSchema` 只用于模型描述，运行时校验靠各工具自查。P1 目标：

- registry 层统一轻量校验（必填/类型/额外字段拒绝），在 dispatch 前拦截；
- 每工具声明输出上限与超时（见下）；
- 校验失败 → model-visible 错误，不执行工具。

## P1 扩展字段（已实装，2026-09-06）

```ts
{
  // v2 扩展（全部可选，缺省走保守值）
  version?: 1
  sideEffect?: 'read' | 'write' | 'process' | 'network'
  timeoutMs?: number
  outputLimitBytes?: number
  cancellable?: boolean
  idempotent?: boolean
  sensitive?: boolean            // 输入/输出需 redaction
  namespace?: string             // 未来 MCP：mcp.<server>.<tool>
}
```

实装语义（`tools/registry.ts` 的 `resolveToolContract` + loop 强制）：

- **兼容规则**：不带扩展字段的旧工具按 `{sideEffect: readOnly?'read':'write', cancellable:false}` 保守解释（注册即校验，见下）。
- **注册校验**：version 必须为正整数且不得高于 harness 所讲版本（`LOOP_CONTRACT_VERSION`，当前 1，过新即抛错）；sideEffect 枚举校验，`'read'` 要求 `readOnly: true`（其余组合与 readOnly 正交，如 WebFetch 为 `network`+readOnly、TodoWrite 为 `write`+readOnly）；timeoutMs/outputLimitBytes 必须为正数；namespace 必须形如 `<scope>.<name>`。
- **loop 超时强制**：仅对 `cancellable: true` 且声明了 `timeoutMs` 的工具生效——per-call AbortController 链接外层 signal，超时中止并以 `code: 'timeout'` 返回；不可取消的工具绝不 race（避免僵尸执行）。Bash 自管内部超时（默认 120s/上限 600s），不声明 loop 级 deadline。
- **输出预算**：`outputLimitBytes` 由 loop 强制（字节级截断 + 尾注 `[output truncated at N bytes (tool contract)]`），即使工具自身 cap 回归也不会淹没上下文。
- **错误码**（`ToolResult.code`，仅 isError 时有意义）：`invalid_input | not_found | conflict | boundary | policy_denied | timeout | aborted | failed`。unknown tool → `not_found`；权限/策略拒绝 → `policy_denied`；BoundaryError → `boundary`；loop 超时 → `timeout`；外部取消 → `aborted`。provider 错误码词表见 contracts/21。
- **Provider 契约版本**：`LoopProvider.contractVersion` 声明后由 loop 启动时校验，不认识即 fail-fast。transcript `session_start` 与 print JSON 信封携带 `contractVersion: 1`。
- **MCP 对齐备注**（P1.3 已实装）：MCP wire 的 tool annotations（readOnlyHint/destructiveHint/idempotentHint/openWorldHint）是 untrusted hints；本契约字段是一方 normative 声明，适配器可无损映射（sideEffect/cancellable/idempotent → hints；sensitive 映射到权限审计）。适配器契约与命名双形（registry `mcp__s__t` / namespace `mcp.s.t`）见 contracts/25。

## 新增工具 DoD（workflows/30 摘要）

1. `readOnly` 判定正确（宁可保守标 false）；
2. 输入自校验 + 输出有上限；
3. 尊重 signal 与 boundary（若涉文件）；
4. 单元 + 真循环集成 + 安全回归三测；
5. 权限/策略审查：新副作用类型必须同步 operations/52 威胁模型。
