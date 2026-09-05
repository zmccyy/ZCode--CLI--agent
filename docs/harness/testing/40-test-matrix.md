# 40 测试矩阵

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05
> 执行方式：全部从 `ZCode/` 目录；`npm test` = `node --experimental-strip-types --test test/all.test.js`

## 五层测试

| 层 | 范围 | 代表 |
|---|---|---|
| L1 单元 | 纯函数：translate/权限/Bash 分类/边界/护栏/压缩边界/配置归一 | `translate.test.js`、`bashPolicy.test.js`、`boundary.test.js` |
| L2 Provider 契约 | SSE/增量 tool call/usage/错误码/retry-after/abort/坏数据 | `openaiCompatibleProvider.test.js`、`anthropicProvider.test.js`、`providerContract.test.js` |
| L3 真栈集成 | fake SSE → 真 provider → 真 loop → 真六件套 | `test/harness/loop.test.js`、`m2Security.test.js`、`anthropicDialect.test.js`、`compact.test.js`、`resume.test.js` |
| L4 CLI/TUI | argv/envelope/退出码/TUI 交互/恢复链路 | `publicCli.test.js`、`cliPrint.test.js`、`tui.test.js` |
| L5 发布 E2E | 真实网络 + 真实 key + Windows 主路径 | `test/e2e/`（无 key 自动跳过，不进 CI 必须路径） |

## 源码改动 → 必跑矩阵

| 改动 | 必跑 |
|---|---|
| tools/* | L1 tools + L3 loop/m2Security + boundary/bashPolicy（涉文件/命令时） |
| loop.ts | L3 全部 + L4 cliPrint/tui（事件消费） |
| permissions/guardrails | m2Security + runModes + cliPrint |
| providers/* | L2 该 provider + L3 双方言 + openaiProviderRetry |
| transcript/compact/resume | 对应专项 + L3 loop + L4 恢复链路 |
| publicCliCore/harnessPrint/tui | L4 全部 |
| boundary/fsWalk | boundary + tools + L3 + 安全回归（symlink/穿越） |
| config/* | settingsContract + providerEnvironment + providerRuntime + L4 |

## P0 目标场景矩阵（roadmap 各 Loop 的 Gate 输入）

### Loop/Provider（P0-B）
单轮文本；多轮工具；双方言同剧本；429/500/503/网络错误/retry-after 恢复；
**abort 矩阵**：首字节前 / 文本中 / tool call 参数中 / backoff 中 / Bash 运行中；
**协议矩阵**：无 `response_end` EOF、malformed JSON SSE、提前断流、tool call JSON 不完整；
已流 delta 不重放；重试耗尽 → error。

### 工具/安全（P0-C）
相对/绝对/`../`/percent-encoded/反斜杠穿越；sibling-prefix；**symlink escape；Windows junction**；symlink cycle；10k 文件；大文件；Grep 大量匹配；Bash timeout/子进程/孙进程/Ctrl+C。

### Transcript/Resume（P0-D）
正常/跨 cwd/损坏行/半行/无消息/并发 append/链式恢复/**失败 Read 不播种**/**redaction**。

### CLI/Config（P0-E）
plan+yolo 互斥；**--plan --write 拒绝**；--continue 无会话；--resume 越权；--json stdout 纯净。

## 质量门槛（发布 Gate，operations/51 引用）

- L1–L4 全绿、0 网络、0 真实包管理器、确定性（同机连续 3 次同结果）
- typecheck（strict，公共层）+ lint 0 error
- 测试失败不得 skip 掩盖；skip 仅允许 live e2e 无 key 场景
- 已知现状：219 tests / 214 pass / 5 skip（01 篇实测留档）
