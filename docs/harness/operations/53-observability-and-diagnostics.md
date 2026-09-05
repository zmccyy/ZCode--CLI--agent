# 53 可观测性与诊断

> Status: guide（字段设计 normative） · Owner: harness maintainers · Last verified: 2026-09-05

## 三层观测

| 层 | 载体 | 消费方 |
|---|---|---|
| 审计 | transcript JSONL（architecture/15 记录类型表） | resume、事后审计、benchmark 复盘 |
| 实时 | LoopEvent（onEvent）→ CLI 渲染 / TUI | 用户、嵌入方 |
| 诊断 | `doctor`、stderr 提示、`--json` error/warnings | 运维排障 |

## 关联键

```text
sessionId → turn → toolCallId → providerRequestId(P1)
```

任何事件/日志行都应可归位到该链；benchmark 指标（testing/44）全部以 sessionId 聚合。

## 指标集（P1 实装；来源 = loop 内部计时 + usage + 工具 durationMs）

- 启动耗时、TTFT、turn 延迟、工具延迟、总耗时
- retry 次数（按错误分类）、abort 响应耗时
- tokens（input/output/total，含压缩请求）、估算成本
- 压缩次数与压缩率、transcript 字节数
- 子进程数、峰值 RSS（P1 采集）

## 诊断规则

1. **doctor** 必须输出：版本、Node、Git Bash 可用性、provider 模式/端点就绪、模型数、当前权限模式、boundary 状态、transcript 目录、compact 阈值（P0-E 补 effective config 来源标注）。**禁止**输出 API key/Authorization。
2. **错误分类**：所有面向用户的错误带分类 code（architecture/13），CLI 退出码映射见 contracts/23。
3. **警告通道**：非致命问题（transcript 写失败、resume 跳过行数）→ `--json` warnings[] / stderr 文本（P0-D 起）。
4. **日志脱敏**：任何输出路径（stderr/doctor/错误消息）经 redaction 规则（operations/52）。

## transcript 治理

- 位置：`~/.zcode/projects/<sha256(cwd)>/<sessionId>.jsonl`
- 保留：暂不自动清理（登记为 P1 任务：retention/清理命令/磁盘配额）。
- 权限：跟随用户默认；Windows 下登记为已知限制。
- 排障路径：`zcode sessions` 定位 → 直接读 JSONL → 关键字段见 architecture/15 记录类型表。
