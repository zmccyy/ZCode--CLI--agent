# 33 工作流：修改 Transcript / Compact / Resume

> Status: guide · Owner: harness maintainers · Last verified: 2026-09-05
> 前置阅读：[architecture/15](../architecture/15-transcript-compact-resume.md)

## Transcript 变更

```text
1. schema 影响？    新字段（可选）→ 向后兼容，直接做
                    改名/删除/语义变化 → 必须加 schemaVersion 并保持旧 reader 可读
2. redaction 检查   新字段是否携带用户内容/敏感值 → 过 redaction 规则（operations/52）
3. 测试             写读回环、损坏行容错、崩溃恢复（半行）、并发 append 顺序
4. resume 兼容      旧 transcript 在新代码下可恢复；新 transcript 至少向下兼容一版 reader
```

## Compact 变更

1. 保留边界规则（不悬空 tool result）优先于一切优化——先测边界再改逻辑。
2. 摘要 prompt 变化 → 检查结构化 memento 方向（architecture/15 P1 schema）不被破坏。
3. 触发阈值/保留条数变化 → 环境变量默认值与 api-reference 同步。

## Resume 变更

1. **只信成功执行事实**：任何“从历史重建状态”的逻辑必须基于 `tool_execution_end`（非 error）类事实，禁止基于 assistant 意图（D1 教训）。
2. 跨 cwd 语义不变：相对路径按原始 cwd 解析（现有测试锁定）。
3. 自包含回放不变：恢复历史写入新 transcript，可链式恢复。
4. 校验收紧时：损坏 transcript 的行为 = 跳过 + 计数 + 提示，禁止静默丢弃整段历史。

## DoD

- [ ] schemaVersion 策略明确（新字段/破坏性变更二选一走对路径）
- [ ] 损坏行/半行/并发回归测试绿
- [ ] resume 全链路测试绿（--continue、--resume id、--resume path、跨 cwd）
- [ ] architecture/15 记录类型表同步
