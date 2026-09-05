# 22 工具注册与执行契约

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05（v1.4.0）
> Source of truth: `ZCode/src/harness/types.ts`（ToolDefinition/ToolContext/ToolSessionState）+ `tools/registry.ts`
> Test refs: `test/harness/tools.test.js`、`test/harness/m2Security.test.js`

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

## P1 扩展字段（冻结设计，防止届时随意加）

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

兼容规则：不带扩展字段的旧工具按 `{sideEffect: readOnly?'read':'write', cancellable:false}` 保守解释。

## 新增工具 DoD（workflows/30 摘要）

1. `readOnly` 判定正确（宁可保守标 false）；
2. 输入自校验 + 输出有上限；
3. 尊重 signal 与 boundary（若涉文件）；
4. 单元 + 真循环集成 + 安全回归三测；
5. 权限/策略审查：新副作用类型必须同步 operations/52 威胁模型。
