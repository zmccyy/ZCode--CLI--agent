# 30 工作流：新增 / 修改 / 删除工具

> Status: guide · Owner: harness maintainers · Last verified: 2026-09-05
> 前置阅读：[contracts/22](../contracts/22-tool-registry-contract.md)、[architecture/14](../architecture/14-tools-permissions-boundary.md)

## 流程总览（契约先行）

```text
1. 契约与测试先行     contracts/22 若需扩展字段 → 先改文档 + registry 测试
2. 实现工具           tools/<name>.ts + 注册于 tools/index.ts
3. 三层测试           单元 + 真循环集成（fakeLlmServer 剧本）+ 安全回归
4. 全量验证           typecheck + lint + test 全绿
5. 文档同步           tools/ 内自文档 + 受影响 contracts/testing/operations 条目
```

## 新增工具清单（DoD）

- [ ] `readOnly` 判定正确（不确定时标 `false` 保守处理）
- [ ] 输入自校验（必填/类型/边界），错误 model-visible
- [ ] 输出有上限（截断 + `[truncated]` 标注），单条过大不回灌
- [ ] 尊重 `context.signal`（入口检查 + 长操作内部可中断）
- [ ] 涉文件 → 必须经 `resolveWorkspacePath`（boundary）；涉命令 → 明确与 bashPolicy 的关系
- [ ] 失败走 `isError: true`，不抛业务异常
- [ ] 集成测试：Plan 模式拒绝（非只读时）/ Agent 审批 / YOLO 放行 三态验证
- [ ] transcript 审计条目完整（tool_execution_start/end）
- [ ] 新副作用类型 → 更新 operations/52 威胁模型

## 修改既有工具

1. 先找锁定当前行为的测试（tools.test.js / 专项测试）；无锁定先补测试再改行为。
2. 语义变化（前置条件、输出格式、权限）必须同步：
   - `architecture/14` 的工具语义表
   - 提示词/工具描述中的自文档
   - `api-reference`（若工具行为用户可见）
3. 破坏性变化（如 Edit 匹配规则收紧）在 CHANGELOG 显著标注，并确认 fakeLlmServer 剧本更新。

## 删除工具

1. 确认无注册引用（tools/index.ts）与剧本依赖。
2. transcript 兼容：旧会话历史中该工具调用恢复时按未知工具处理（可恢复，不崩溃）。
3. api-reference / README 移除声明。

## 反模式（禁止）

- 在表现层直接调用工具执行函数（绕过权限门）。
- 用抛异常表达正常业务失败。
- 无上限的输出回灌。
- 跳过 boundary 的“快捷路径”。
