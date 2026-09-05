# 31 工作流：新增 / 修改 Provider

> Status: guide · Owner: provider maintainers · Last verified: 2026-09-05
> 前置阅读：[contracts/21](../contracts/21-provider-adapter-contract.md)、[architecture/13](../architecture/13-provider-dialect.md)

## 新增 Provider

```text
1. 适配器实现        src/providers/<name>.js，实现 LoopProvider 最小接口
2. 契约测试          通过 providerContract.test.js 全部用例
3. 方言接线          若属新方言：translate.ts 增加 translateRequest/translateMessages 分支
                     若复用 OpenAI 兼容或 Anthropic 方言：仅实现传输层
4. 剧本集成          fakeLlmServer.js 支持该方言 SSE → 真循环剧本测试
5. 能力声明          getCapabilities() 全量声明（contracts/21 schema）；不支持的能力显式声明
6. 注册与路由        runtime.js / modelRegistry.js / providerEnvironment.js
7. live e2e          test/e2e/ 单独 gate（无 key 自动跳过，不进普通 CI 必须路径）
8. 文档同步          api-reference 支持矩阵、doctor 输出、README
```

## 修改既有 Provider

1. **先锁行为**：SSE 解析、增量合并、retry、abort、usage 均有测试锁定（openaiCompatibleProvider / anthropicProvider / anthropicStreamChat）；无锁先补。
2. 重试语义改动 → 必须同步 contracts/21 重试纪律与 architecture/13 矩阵，且验证与 loop 层重试的叠加预算（B4 修复后的共享 deadline 测试）。
3. 错误分类改动 → `--json` error code 消费方（contracts/23）同步。
4. 禁止把方言判断写进 `src/harness/`（分层红线，architecture/10）。

## 常见坑（来自既有实现）

- SSE 跨 chunk 分帧：事件可能被网络分片切断，必须缓冲重组（anthropicStreamChat 测试覆盖 CRLF 与分帧）。
- `retry-after` 可能恶意巨大：解析后设上限。
- abort 时 fetch body 未消费 → 挂起：确保 reader 取消。
- usage 缺字段：省略而非伪造。

## DoD

- [ ] providerContract 全绿 + 方言剧本真循环全绿
- [ ] capability 声明完整且与实现一致
- [ ] 文档矩阵三处同步（api-reference / doctor / harness contracts）
- [ ] live e2e gate 存在且默认跳过逻辑正确
