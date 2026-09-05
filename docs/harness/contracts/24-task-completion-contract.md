# 24 任务完成契约（Task Completion Contract）

> Status: normative（P1 实装；P0 起作为 review 判定基准） · Owner: harness maintainers
> Source refs: [02-product-principles-and-dod](../02-product-principles-and-dod.md)、[architecture/12](../architecture/12-task-lifecycle-and-completion.md)

## 设计动机

`stopReason` 只描述循环为何停止。用户与下游系统需要的是**任务是否完成、完成到什么程度、证据是什么**。本契约定义机器可读的完成协议，由 `AgentLoopResult.status`（P1 字段）与 `--json` envelope 共同承载。

## Schema

```ts
interface TaskCompletion {
  status: 'complete' | 'partial' | 'blocked' | 'failed' | 'aborted'
  criteria: Array<{
    name: string                 // 验收条件短名
    status: 'pass' | 'fail' | 'unverified' | 'blocked'
    evidence?: string            // 命令/输出摘要/文件路径
  }>
  changedFiles: string[]         // 全部被修改/创建的文件（相对 cwd）
  tests: Array<{ command: string; exitCode: number; summary: string }>
  blockers?: string[]            // status=blocked 时必填：解除阻塞所需的具体输入
  leftovers?: string[]           // 已知未完成项
}
```

## status 与 stopReason 映射（normative，重复 02 篇表格以保证本篇自洽）

| stopReason | 允许 status |
|---|---|
| `end_turn` | complete / partial / blocked / failed |
| `max_turns` / `budget_exceeded` | partial / blocked |
| `aborted` | aborted |
| `error` | failed / blocked |

## 生成规则

1. **谁来判定**：P1 前由模型在最终回答中按 schema 自报（prompt 注入 schema），harness 校验 status 与 stopReason 映射合法；P1 起 FINISH 检查器参与判定——`tests[]` 为空且 criteria 存在 fail/unverified 时，最高只允许 `partial`。
2. **changedFiles**：P1 起由 harness 侧从 Write/Edit 工具执行记录自动收集，模型自报仅作补充（防谎报）。
3. **tests[]**：harness 侧记录 VERIFY 阶段（或一切以验证为目的）Bash 调用的命令与退出码；模型自报需与之交叉验证，不一致以 harness 记录为准并降级 status。
4. **aborted**：保留已完成 criteria 与 changedFiles，便于恢复后续接。

## 消费方

| 消费方 | 用法 |
|---|---|
| CLI 文本输出 | 末尾渲染 status + criteria 摘要 |
| `--json` | 顶层 `status` 字段 + 完整 `completion` 对象（P1） |
| transcript | `result` 条目附 completion |
| 未来 workflow/sub-agent | 父任务聚合子任务 completion（P2） |

## 退出码联动（contracts/23 扩展）

`status=blocked` 且非用户取消 → 退出码 4；`status=failed` → 1；`partial` → 0（含明确 leftover 说明）。

## Failure semantics

- 模型未按 schema 自报 → status 缺省 `partial`，criteria 为空，leftover 注明“completion schema missing”。
- 判定器本身异常 → 不阻塞 loop，status 退化为按 stopReason 映射的保守值，错误入 warnings。
