# 42 UC-03 发布门验收

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05
> 证据链：`docs/acceptance/uc03-acceptance.md`（记录）· `uc03-run-output.log` · `uc03-transcript.jsonl` · `uc03-workspace/`（故障初态夹具）

## 任务定义

```bash
zcode -p "修复所有失败的测试" --yolo
```

在 `uc03-workspace`（预置两个失败测试 + 实现 bug）上，**无人工干预**完成：

```text
Grep（定位失败测试）→ Read（读实现）→ Bash（跑测试确认）→ Edit（修复）→ Bash（复跑通过）
```

## 发布门判定（全过才放行）

- [ ] `stopReason === 'end_turn'`
- [ ] 目标测试从失败变为通过（夹具初态的失败是**故意的**，非产品缺陷）
- [ ] 修改范围仅预期源文件；**测试文件零改动**
- [ ] 无人工审批交互（--yolo），且 deny 列表拦截仍然有效
- [ ] transcript 事件顺序与终端报告一致（可审计）
- [ ] 双方言可跑（OpenAI 兼容剧本 + Anthropic 剧本；live 验收至少一方真实 key）

## 执行与留档

1. 发布前在干净环境重跑；输出/转录留档为新版本文件（不覆盖历史留档）。
2. 留档前脱敏检查：API key 等敏感值以占位符形式出现（operations/52 规则）；`uc03-transcript.jsonl` 中的 `sk-REDACTED-ROTATED` 即占位符先例。
3. 结果记入发布 checklist（operations/51）。

## Failure semantics

- 任何一条判定失败 → 发布阻断；修复后完整重跑（不接受部分重跑）。
- live key 不可用时：剧本版 UC-03（fakeLlmServer 驱动同一 workspace 夹具）必须通过；live 留档可延后但不得缺失超过一个 minor 周期。
