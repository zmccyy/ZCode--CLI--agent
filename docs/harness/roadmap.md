# Roadmap —— 唯一活跃开发计划（P0–P2）

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05
> 执行方式：Loop Engineering —— 每个 Loop：改 → `typecheck+lint+test` 全绿 → 记录证据 → 下一 Loop。失败就地修复，不可定位则回退该 Loop 改动。
> 工程根：`ZCode/`。不新增运行时依赖；不触碰根 `package.json` 现场修改与 `.zcode/`；不自动 git 提交。

## P0 可靠性闭环（本次自治开发交付）

### Loop 2 · P0-A 确定性测试基线 ✅（2026-09-05）
- [x] A1：`bashPolicy.test.js` loop 集成用例注入 fake runner/fixture，杜绝真实 `npm install` 与网络（ask 桶改用 `node -e`，224ms 离线完成；两集成用例加 30s 超时）
- [x] 测试无残留子进程/服务器/临时目录；单用例与套件超时存在
- **Gate ✅**：`npm test` 219 tests / 0 fail / 18.4s；普通测试零网络

### Loop 3 · P0-B 取消与流协议 ✅（2026-09-05）
- [x] B1：`consumeTurn` 要求 `response_end` 闭合；EOF/malformed/截断 → 协议错误；abort → `stopReason='aborted'`（中断轮不写入历史，防悬空 tool_call）
- [x] B2：Bash 监听 `context.signal`；超时/取消 kill 进程树（win32 taskkill /T /F；POSIX 进程组）
- [x] B3：Glob/Grep/walk 贯穿 signal
- [x] B4：统一 retry——loop 经 `streamInput.maxRetries=0` 收编 provider 内建重试，单轮最坏请求从 9 降为 3
- [x] B5：loop backoff signal-aware（`abortableDelay`）
- [x] 测试：`turnProtocol.test.js` 9 用例——EOF×2（双方言）、malformed 跳过/升级、abort 矩阵×5（首字节前/文本中/Bash 中/退避中/anthropic）
- **Gate ✅**：abort 实测 150–550ms 返回（门 2s）；abort 不落 `end_turn`；协议错误不重试；228 tests 0 fail

### Loop 4 · P0-C 文件边界与进程安全 ✅（2026-09-05）
- [x] C1：boundary realpath 化——`assertRealpathInsideBoundary`：最近存在祖先 realpath + 词法尾部拼接；根 realpath 缓存；win32 大小写归一；`resolveWorkspacePath` 升级为 async 双重校验（词法 + 文件系统真相）
- [x] C2：fsWalk 显式跳过 symlink/junction（不跟随、不产出、无 cycle）、根为文件返回单条目、新增 maxTotalBytes/maxWalkMs 预算
- [x] 测试：`boundaryRealpath.test.js` 8 用例（junction 逃逸、symlink 文件逃逸、real-prefix 写入回归、sibling-prefix、walk 预算/文件根/自引用 junction）
- **Gate ✅**：越界 0；236 tests 0 fail（本机 2 个 file-symlink 用例因权限 skip，junction 用例覆盖同等防护）

### Loop 5 · P0-D transcript/resume 可信化 ✅（2026-09-05）
- [x] D1：`collectReadFilesFromMessages`（resume.ts）——只从**成功执行**的 Read（有对应非 error tool 结果）播种 readFiles；失败/被拒/中断的 Read 不播种；loop.ts 弃用意图式 `rebuildReadFilesFromMessage`
- [x] D2：transcript 写失败 → `AgentLoopResult.warnings[]`（types.ts 新字段）→ CLI stderr `WARNING:` / TUI `⚠` / JSON envelope `warnings`
- [x] D3：transcript 序列化层 redaction——sk-/key-/ghp_/xox + Authorization/x-api-key/api_key 头与赋值 → `[REDACTED]`，行保持可解析
- [x] 测试：`resumeReadSeed.test.js` 7 用例（失败/成功/无结果/跨 cwd 播种、端到端 resume 后 Edit 仍被拒、redaction 落盘、写失败 warning）
- **Gate ✅**：恢复语义回归全绿；敏感值不落盘；243 tests 0 fail

### Loop 6 · P0-E CLI 契约与事实校正 ✅（2026-09-05）
- [x] E1：`--plan` + `--write` 组合在 parseArgv 即拒绝（UsageError → 退出码 2）；CLI 回归锁定
- [x] 退出码映射实现：end_turn→0、UsageError→2、max_turns/budget→3、aborted→130、其余错误→1（contracts/23 落地）
- [x] E4：事实校正——implementation-status 状态矩阵、api-reference（doctor 示例/envelope 字段/Provider 矩阵/退出码/sessions）、双语 README 徽章与能力表、docs/README 导航 + historical 声明
- **Gate ✅**：CLI 测试全绿；文档声明与代码/测试一致（245 tests 0 fail）

### Loop 7 · 收尾 ✅（2026-09-05）
- [x] 本 roadmap 勾选、`ZCode/CHANGELOG.md` 记 Unreleased（含 v1.3 MCP 声明校正）
- [x] 文档链接检查：31 篇 0 断链；doctor/models 冒烟正常；plan+write→2、bad option→2 实测
- [x] 最终全量验证：**245 tests / 238 pass / 0 fail / 7 skip / 18.0s** + typecheck/lint 0 error

## P0 完成总结（2026-09-05）

P0 可靠性闭环交付：确定性测试基线（P0-A）、取消与流协议（P0-B）、realpath 边界（P0-C）、transcript/resume 可信化（P0-D）、CLI 契约与事实校正（P0-E）。每步 Loop 均有 Gate 证据，roadmap 勾选即为验收记录。后续 P1（契约版本化/观测/MCP stdio/配置接线/StuckDetector）与 P2（工作流/子 Agent/沙箱）按本 roadmap 推进。

## P1 扩展运行时（本次不实现，已规划）

1. **契约版本化**：ToolDefinition/Event/Provider 增加 version、side-effect class、timeout、output budget、cancellation 声明、error code（contracts/22、21 已预留字段设计）。
2. **观测与 benchmark**：metrics（TTFT/turn/tool 延迟、retry、tokens、RSS）+ 确定性 benchmark harness（testing/44）。
3. **MCP stdio 最小子集**：handshake、tools/list+call、`mcp.<server>.<tool>` namespace、统一权限/边界/审计、超时/崩溃/重连、默认关闭；adapter 稳定后才接 `mcp list/ping/...` 命令。
4. **配置接线**：settings 五层真正接入 CLI 启动链 + doctor effective config（E2 补充）。
5. **有界 StuckDetector**：同一失败路径 3 次 → 强制换策略/缩小问题/询问/结束（architecture/12）。

Gate：fake MCP 全链路稳定、工具名零冲突、主 loop 不被 server 阻塞、warm call p95 ≤ 直接工具 1.25×。

## P2 持久化工作流与受控协作（本次不实现）

1. **Workflow DAG/状态机**：typed input/output、approval checkpoint、retry/compensation、idempotency、durable resume。Gate：恢复 ≥99%、重复副作用 0。
2. **有界 Sub-agent**：depth/concurrency/token/time/工具白名单/policy 继承/取消传播。Gate：预算 100% 终止、4 路并行加速 ≥1.5×。
3. **Hooks/LSP**：只读诊断适配器；hook 失败不得静默改变安全决策。
4. **沙箱与远程**：sandbox-runtime、可插拔 remote executor——全部 experimental flag + kill switch + fail-closed。

## 回滚

每 Loop 小步提交粒度（工作树内独立可辨）；某 Loop 引发不可定位回归 → 回退该 Loop 改动并保留测试资产；不改变默认权限语义；transcript reader 保持向后兼容。
