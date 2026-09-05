# 12 任务生命周期与完成协议（Task Lifecycle）

> Status: normative（v1.5 演进目标；本篇同时约束 P0 的完成判定预留） · Owner: harness maintainers
> Source refs: [02-product-principles-and-dod](../02-product-principles-and-dod.md)、[contracts/24](../contracts/24-task-completion-contract.md)
> 对标来源：调研报告（SWE-agent 的 inspect→reproduce→edit→verify→submit、Cline Plan/Act、OpenHands partial/blocked、LangGraph checkpoint）

## 设计立场

当前 loop.ts 只有“轮”的概念，任务状态隐含在 prompt 与模型自觉中。目标：把生命周期提升为**运行时协议**，但不引入重型图框架（LangGraph 类）——在现有 loop 上以轻量状态机 + checkpoint 演进。

## 状态机

```text
INTAKE ──► PLAN ──► ACT ──► VERIFY ──► FINISH
   │         │        ▲        │          │
   │         │        │        ├─ 失败 ───┘（回到 ACT，带失败分类）
   │         │        │        └─ 重复失败 ─► REPLAN ─► ACT
   │         ▼        ▼
   └─────► BLOCKED / ABORTED（任意阶段可达）
```

## 各阶段硬约束（运行时强制，不是提示词建议）

| 阶段 | 允许 | 禁止 | 映射到现有机制 |
|---|---|---|---|
| INTAKE | 解析目标为验收条件清单 | 调用任何写工具 | session_start + 初始 user 消息 |
| PLAN | Read/Glob/Grep/只读 Bash（allowlist）；产出计划与验收条件 | 写文件/安装/改 Git/网络副作用 | `permissionMode='plan'`（permissions.ts 已强制） |
| ACT | 经授权的 Edit/Write/Bash | 越权、deny 命令 | Agent/YOLO 模式 + bashPolicy |
| VERIFY | 运行 test/build/lint/smoke；读取结果 | 修改代码（VERIFY 中发现需修改 → 回 ACT） | Bash + 结果分类 |
| FINISH | 汇总证据（contracts/24 schema） | 无验证证据时声明 complete | loop 结束前的完成检查（预留） |
| BLOCKED | 输出解除阻塞所需输入 | 继续猜测、重复无效尝试 | StuckDetector 触发条件之一 |

## 验证分类（VERIFY 输出）

```text
test_failure | compile_failure | environment_failure | permission_failure | timeout | unknown
```

失败分类决定下一步动作：修代码（ACT）/ 调整命令 / 请求权限 / 缩小范围 / 进入 BLOCKED。

## 有界 StuckDetector（P1 实现，约束先行）

触发条件（任一）：
- 同一工具 + 等价输入连续失败 ≥ 3 次
- 连续 2 轮无有效 diff（Edit/Write 结果为 error 或 no-op）
- VERIFY 结果完全不变且预算持续消耗

触发后只允许四种动作：**换策略 / 缩小问题 / 请求用户（→BLOCKED）/ 结束并报告**。禁止无界自我反思（AutoGPT 教训）。

## Checkpoint（P1/P2）

每个阶段转换写入 transcript 的 `phase` 条目：`{phase, enteredAt, summary, budget}`；恢复时从最后 checkpoint 继续，不依赖全量重放。

## 与 stopReason 的关系

- loop `stopReason` 描述**循环**为何停止（architecture/11）。
- task `status` 描述**任务**完成度（contracts/24）。二者独立记录，禁止混用（02 篇映射表为准）。

## Failure semantics

- VERIFY 失败不是 loop 错误；它是一条普通 tool 结果 + 失败分类标注。
- FINISH 检查（P1 落地）发现无验证证据时，status 最多为 `partial`，并在结果中注明缺失证据项。
