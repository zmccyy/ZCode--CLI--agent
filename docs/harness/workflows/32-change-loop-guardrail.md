# 32 工作流：修改循环 / 护栏 / 权限

> Status: guide · Owner: harness maintainers · Last verified: 2026-09-05
> 前置阅读：[architecture/11](../architecture/11-agent-loop.md)、[architecture/14](../architecture/14-tools-permissions-boundary.md)、[contracts/20](../contracts/20-message-event-contract.md)

## 铁律：先测试后实现

循环是全系统的信任基座。任何 `loop.ts` / `guardrails.ts` / `permissions.ts` / `compact.ts` 改动：

```text
1. 写失败路径测试（在改动会引入的新行为上失败）
2. 跑既有全量套件确认无隐性依赖
3. 改实现
4. 全绿 + 新测试通过
5. 同步 architecture/11 不变量清单（若有新不变量）
```

## 必须覆盖的检查面（按改动类型）

| 改动 | 必查 |
|---|---|
| turn 生命周期 / 流消费 | 配对完整、ID 一致、不重放、abort 语义（architecture/11 全部不变量）；EOF/malformed/abort 注入矩阵（testing/40） |
| retry / backoff | 已流 delta 不重放；共享预算与 deadline；backoff 可中断；重试耗尽 → error 分类正确 |
| compact | 悬空 tool_result 边界；摘要失败继续跑；usage 计入；每轮不重复尝试 |
| guardrails（maxTurns/budget） | 触发时机（轮首）；stopReason 正确；transcript guardrail 条目；已完成工作保留 |
| permissions | fail-closed；deny 覆盖 YOLO；拒绝产生 model-visible 结果 + permission_denied 审计；**任何放宽必须给出威胁模型更新（operations/52）** |
| resume 播种 | 只信成功执行事实（architecture/15）；跨 cwd 相对路径；自包含回放 |
| 事件/结果 schema | contracts/20 兼容策略；`--json` 消费方同步 |

## 权限语义红线

1. Agent 无审批者 fail-closed —— 不可配置关闭。
2. deny 列表覆盖含 YOLO 的一切模式。
3. Plan 模式零写入 —— 含 CLI 后处理（--write）与未来任何旁路。
4. 放宽默认权限的 PR 需 Owner 批准 + 威胁模型 diff + 独立的安全回归测试。

## 剧本测试写法（速查）

见 [testing/41](../testing/41-fake-llm-and-fixtures.md)。要点：剧本 = 每轮 HTTP 请求的 SSE 事件序列；断言用真实 `AgentLoopResult`（messages/toolCalls/stopReason）而非 mock 计数。

## DoD

- [ ] 新行为有失败路径测试；不变量清单已更新
- [ ] 全量套件绿；abort/EOF 矩阵（若涉流）绿
- [ ] architecture/11 状态机图与实现一致
- [ ] 权限改动附威胁模型 diff
