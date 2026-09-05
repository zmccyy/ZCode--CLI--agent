# 需求 → 能力映射（requirements-to-capability）

> Status: normative（防止历史需求继续冒充实现契约） · Owner: harness maintainers · Last verified: 2026-09-05
> 输入：`docs/requirements-analysis.md`（2026-06-09，historical）、`docs/ZCode_SRS.docx`（2026-05-28，historical）、`docs/系统设计说明书.md`（historical）

状态语义：**implemented**（有代码+测试）/ **partial**（有代码缺闭环）/ **deferred**（roadmap 有位）/ **retired**（不再目标）。

## 核心能力映射

| 历史需求（来源） | 状态 | 证据 / 目标 |
|---|---|---|
| 多轮 Agent 工具循环（SRS/需求） | implemented | `loop.ts` + `test/harness/loop.test.js` |
| Read/Glob/Grep/Write/Edit/Bash | implemented | `tools/` + `tools.test.js` |
| 权限三模式 + fail-closed | implemented | `permissions.ts` + `m2Security.test.js`（P0-E 补 plan+write CLI 侧闭环） |
| 护栏（轮数/预算） | implemented | `guardrails.ts` + `m2Security.test.js` |
| 会话转录 JSONL | implemented | `transcript.ts`（P0-D 加固） |
| 自动上下文压缩 | implemented | `compact.ts` + `compact.test.js`（结构化 memento → P1） |
| 会话恢复 | implemented | `resume.ts` + `resume.test.js`（播种收紧 → P0-D） |
| OpenAI 兼容 + Anthropic | implemented | `providers/` + 双方言测试 |
| 工作区边界 | partial | 词法 containment 已实现；realpath/symlink → P0-C |
| Bash 门控 | partial | 分类器已实现；取消/进程树 → P0-B；沙箱 → P2 |
| 零依赖 TUI（Node24 readline） | implemented | `cli/tui.js` + `tui.test.js`（resume 元数据传递 → P0-E 记录） |
| 配置文件分层（settingsContract） | partial | 契约+单测在；CLI 接线 → P1（roadmap P1-4） |
| MCP 接入 | deferred | v1.3 CHANGELOG 声明不实（参考树已删）；stdio 最小子集 → P1（roadmap P1-3） |
| 任务生命周期/完成协议 | partial | 契约已定（contracts/24）；实装 → P1 |
| StuckDetector / 有界反思 | deferred | 约束已定（architecture/12）；P1 |
| 子 Agent | deferred | 有界设计 → P2 |
| Workflow DAG / checkpoint | deferred | P2 |
| Hooks / LSP 诊断 | deferred | P2（只读适配器约束已定） |
| 沙箱 runtime | deferred | P2；此前文档诚实声明非沙箱 |
| 远程执行 | deferred | P2 可插拔 executor |
| OAuth 登录 / 云端控制 / IDE 集成 / 1000 轮会话（SRS 愿景） | retired | 与本地运行时定位冲突；不进 roadmap |
| Bun 作为核心运行时 | retired | Node ≥ 24 主路径（ADR-0001 语境）；Bun 仅实验脚本 |

## 处置规则

1. 历史文档标记 historical，页首注明“不作为当前实现依据”。
2. 新需求一律先进 roadmap（P0–P2），带 Gate 与证据要求，再进实现。
3. 本映射随 roadmap 勾选同步更新；retired 项复活需重新走范围评审（00 篇 scope）。
