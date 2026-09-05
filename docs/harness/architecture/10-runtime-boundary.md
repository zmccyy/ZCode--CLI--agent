# 10 运行时边界与分层

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05（v1.4.0）
> Code refs: `ZCode/src/entrypoints/publicCli.js`、`src/cli/publicCliCore.js`、`src/cli/harnessPrint.js`、`src/cli/tui.js`、`src/harness/`
> Test refs: `test/publicCli.test.js`、`test/harness/cliPrint.test.js`、`test/harness/tui.test.js`

## 调用链（唯一合法链路）

```text
publicCli.js（entrypoint）
  └─ runCli(publicCliCore.js)        argv 解析 / .env / provider 构建 / resume 快照
       ├─ -p 模式 → runHarnessPrint(harnessPrint.js)   注入 system+六工具+boundary+transcript
       │    └─ runAgentLoop(loop.ts)                    Think→Act→Observe
       │         ├─ translate.ts                        内部消息 ⇄ OpenAI/Anthropic 方言
       │         ├─ provider.streamChat()               SSE 流（src/providers/*）
       │         ├─ permissions.ts → tools/*            权限门 → 工具执行
       │         └─ transcript.ts                       JSONL 落盘
       └─ TTY 裸命令 → runTui(tui.js) → 同一个 runAgentLoop
```

子命令（`help/doctor/models/sessions/print`）在 `publicCliCore.js` 内直接处理，不进入 loop。

## 分层规则（违反即缺陷）

1. **表现层不得复制 Agent 循环**。CLI、TUI、测试、未来 SDK 全部经由 `runAgentLoop`；禁止在表现层自行实现“模型+工具”编排。
2. **Harness 不感知 wire format**。`loop.ts` 只消费 `types.ts` 的 canonical 形态；SSE 细节止步于 `src/providers/` 与 `translate.ts`。
3. **工具不感知 provider**。工具只见 `ToolContext`（cwd/state/signal/boundary），见 [contracts/22](../contracts/22-tool-registry-contract.md)。
4. **权限门是唯一副作用入口**。所有工具调用必须经过 `checkPermission`；新工具自动纳入 Plan/Agent/YOLO 语义（readOnly 字段）。
5. **transcript 是持久化事实源**。表现层渲染可裁剪，落盘不可裁剪（除 redaction 规则，operations/52）。

## 进程与环境边界

| 项 | 约定 |
|---|---|
| 运行时 | Node ≥ 24，原生 TS 类型剥离（`node --experimental-strip-types`），零构建 |
| 主平台 | Windows + Git Bash；Bash 工具统一 `bash -c` 执行 |
| 工程根 | 一切 npm 命令从 `ZCode/` 执行（仓库根 package.json 不是运行时入口） |
| 依赖 | 运行时仅 `picomatch`；禁止未经评审引入新运行时依赖 |
| 类型检查范围 | `tsconfig.public.json`（`checkJs: false` —— JS 层质量由测试保证，见 testing/40） |

## 失败语义

- provider 层错误（认证/限流/网络/超时）在 provider 内分类并重试；只有“未产生任何 delta 的失败”才允许 loop 层重试（`loop.ts` retry 注释为契约：已流式输出的轮次不重放）。
- 观察者（`onEvent`）异常必须被隔离（`loop.ts` emit 的 try/catch），不得破坏循环。
- transcript 写失败不得掩盖 loop 结果，但**必须可见**（P0-D 收紧，当前实现静默吞掉是已知缺陷 D2）。

## Security notes

- 文件 boundary 只约束文件工具；Bash 信任模型见 [operations/52](../operations/52-security-threat-model.md)。
- `--no-boundary` 为显式逃生；`--add-dir` 仅扩展文件工具可信根。
