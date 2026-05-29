# ZCode CLI Agent 详细开发计划 v2

> 制定日期：2026-05-28
> 基于完整代码审计与现有文档综合评估

---

## 1. 项目现状总结

### 1.1 已实现且稳定的功能

| 模块 | 状态 | 证据 |
|------|------|------|
| **公共 CLI 入口** | ✅ 稳定 | `ZCode/src/entrypoints/publicCli.js` + `publicCliCore.js`，支持 `--help`/`doctor`/`models`/`-p --json` |
| **OpenAI-compatible Provider** | ✅ 稳定 | `providers/openaiCompatible.js`，完整 SSE 解析、tool_call 增量合并、超时控制 |
| **Provider Runtime 选择** | ✅ 稳定 | `providers/runtime.js`，env → provider mode 解析、settings 合并、双线路切换 |
| **ProviderAdapter Contract** | ✅ 稳定 | `contracts/providerAdapter.js`，统一 `streamChat`/`listModels`/`normalizeToolCalls` |
| **ModelRegistry** | ✅ 稳定 | `providers/modelRegistry.js`，`has`/`get`/`list`/`listByProvider` |
| **Settings Contract** | ✅ 稳定 | `config/settingsContract.js`，优先级合并、OpenAI-compatible 归一化 |
| **Provider Environment Bridge** | ✅ 稳定 | `config/providerEnvironment.js`，settings → env 双向桥接 |
| **Brand Config 基础** | ✅ 稳定 | `config/brandConfig.js` + `brandText.js`，产品名/URL/命令空间可配置 |
| **Anthropic Provider 主线** | ✅ 稳定 | `providers/anthropic.js`，完整 SSE streamChat + tool_use 增量合并 + abort 处理 |
| **Anthropic 透传适配器** | ✅ 稳定 | `services/api/anthropicAdapterClient.ts`，SDK 兼容 `beta.messages.create` 接口 |
| **双线路 ModelRegistry** | ✅ 稳定 | `providers/runtime.js`，`createDualLineModelRegistry` 合并 Anthropic + OpenAI-compatible 线路 |
| **Settings 文件 I/O** | ✅ 稳定 | `settingsContract.js`，`loadSettingsFromDisk`/`saveSettingsForSource` 5 层合并 + 磁盘读写 |
| **.env 加载** | ✅ 稳定 | `publicCliCore.js` 内 `loadDotEnvFile`，不覆盖已有变量 |
| **自动化测试框架** | ✅ 稳定 | 80 条测试，全部通过 |
| **Phase 2 回归矩阵定义** | ✅ 稳定 | 12 条核心场景 S01-S12 已建立，带线路标记 |

### 1.2 正在开发中的部分及进度

| 模块 | 进度 | 说明 |
|------|------|------|
| **Phase 2 第一波回归测试** | 60% | S01/S02/S05/S06/S11 已有 harness 测试，S03/S04/S07-S10/S12 仍为 planned |
| **公共入口品牌收口** | 70% | Welcome/Help/Remote/Update/IDE onboarding 首层已完成，深层 250 个文件仍有 530 处残留 |
| **Plan Mode 行为抽离** | 80% | `planBehavior.js` 已可测试，但尚未接入完整 TUI 交互路径验证 |
| **Resume 行为抽离** | 80% | `resumeBehavior.js` 已可测试，validate/lookup 逻辑完整 |
| **Permission Surface** | 70% | `toolPermissionSurface.js` 可独立测试 allow/deny/ask，但完整链路未验证 |
| **Anthropic streamChat 边缘场景** | 90% | 基础流式/tool_use/abort 已实现并测试，E2E 真实 API 验证待做 |

### 1.3 完全未开始的部分

| 模块 | 优先级 | 依赖 |
|------|--------|------|
| **Anthropic streamChat E2E 验证** | P0 | 需真实 API Key 做端到端验证 |
| **完整 REPL 交互启动链路** | P0 | 依赖 Anthropic streamChat + TUI 渲染链路 |
| **S03/S04 文件读写回归** | P0 | 需 harness 适配 FileRead/FileEdit/Glob/Grep 工具 |
| **S07 Subagent 回归** | P1 | 需验证 AgentTool + swarm 路径 |
| **S08 Hooks 回归** | P1 | 需验证 hook 事件触发与结果处理 |
| **S09 MCP 回归** | P1 | 需验证连接/发现/调用/失败恢复 |
| **S10 Memory 回归** | P1 | 需验证 memory 读写与 CLAUDE.md 兼容 |
| **S12 Doctor/Update 回归** | P1 | doctor 已基本可用，update 需适配 |
| **Windows 安装脚本** | P1 | GitHub Release 产物设计 |
| **Windows 更新命令** | P1 | 版本检查 + 下载 + 替换流程 |
| **GitHub Release 流程** | P2 | CI/CD pipeline 设计 |
| **用户文档体系** | P2 | 安装/配置/命令参考/FAQ |
| **性能压测** | P2 | 冷启动/长会话/大仓库场景 |

### 1.4 已识别的技术债务和已知问题

| 编号 | 问题 | 影响 | 紧迫度 |
|------|------|------|--------|
| TD-01 | 530 处品牌残留分布在 250 个文件中 | 用户可见不一致 | 中 |
| TD-02 | ~~Anthropic provider 无 streamChat~~ ✅ 已解决 | 主线 TUI 仍需打通 REPL 启动链路 | 中 |
| TD-03 | `model/configs.ts` 仍用 TS 格式，需 `createRequire` hack | 构建脆弱 | 中 |
| TD-04 | 测试依赖 `bun` 命令但 Windows 可能未安装 | 1 条测试持续失败 | 低 |
| TD-05 | QueryEngine 1295 行，与 UI/permissions/session 深度耦合 | 改动风险高 | 中 |
| TD-06 | main.tsx 4685 行，职责过重 | 可维护性差 | 低 |
| TD-07 | MCP client 依赖 `@modelcontextprotocol/sdk` 未在 package.json 声明 | 运行时缺失 | 高 |
| TD-08 | 无 `package-lock.json` 或 `bun.lockb` 在 ZCode/ 目录 | 依赖不确定性 | 中 |
| TD-09 | 历史代码大量 `.ts`/`.tsx` 但 publicCli 链路用纯 `.js` | 两套体系并存 | 低 |
| TD-10 | settings/types.ts 仍是 Claude Code 完整 schema | 语义混乱 | 低 |

---

## 2. 详细任务拆解

### 2.1 Anthropic streamChat 实现（P0 Blocker）

- **目标**：让 `anthropic.js` 的 `streamChat` 能发起流式请求并 yield 标准化 chunk
- **输入**：Anthropic API Key + Messages API 请求参数
- **输出**：`response_start` / `text_delta` / `tool_call` / `response_end` 四种标准事件
- **DoD**：
  1. `createAnthropicProvider()` 返回的 adapter 可调用 `streamChat()` 并获得流式响应
  2. 与 `openaiCompatible.js` 产出相同结构的 chunk
  3. 新增 `test/anthropicStreamChat.test.js` 通过（mock HTTP）
- **预估工时**：3 天

### 2.2 完整 REPL 启动链路打通（P0）

- **目标**：从 `cli.tsx` → `init.ts` → `main.tsx` → `REPL.tsx` 完整启动不报错
- **输入**：有效的 Anthropic API Key 或 OpenAI-compatible 配置
- **输出**：用户可在终端中输入自然语言并获得 LLM 响应
- **DoD**：
  1. `bun run src/entrypoints/cli.tsx` 在 Windows Terminal 中启动成功
  2. 输入一句话后获得流式文本输出
  3. Ctrl+C 可正常退出
- **预估工时**：5 天
- **依赖**：T2.1 完成

### 2.3 文件工具回归 S03+S04（P0）

- **目标**：验证 FileReadTool/FileEditTool/GlobTool/GrepTool 在 Windows 下可用
- **输入**：工具输入参数（路径/模式/内容）
- **输出**：工具执行结果字符串
- **DoD**：
  1. FileReadTool 可读取 Windows 路径文件
  2. FileEditTool 可搜索替换并持久化
  3. GlobTool/GrepTool 可调用 ripgrep 搜索
  4. `test/phase2FileTools.test.js` 至少 6 条用例通过
- **预估工时**：3 天
- **依赖**：ripgrep 二进制可用

### 2.4 Shell 执行回归 S05（P0）

- **目标**：验证 BashTool/PowerShellTool 在 Windows 下正确执行命令
- **输入**：命令字符串 + 工作目录
- **输出**：stdout/stderr/exitCode
- **DoD**：
  1. PowerShellTool 可执行 `Get-ChildItem` 类命令
  2. BashTool 在 Git Bash 环境下可执行 `ls`/`cat`
  3. 超时中断机制正常工作
  4. 已有 S05 harness 测试保持通过
- **预估工时**：2 天

### 2.5 Subagent 回归 S07（P1）

- **目标**：验证 AgentTool 可创建子代理并完成任务
- **输入**：子代理描述 + 委派任务
- **输出**：子代理完成结果
- **DoD**：
  1. `AgentTool.call()` 可 fork 子对话
  2. 子代理可使用 FileRead/Bash 工具
  3. 结果正确回传主循环
  4. `test/phase2Subagent.test.js` 通过
- **预估工时**：4 天
- **依赖**：T2.2 完成

### 2.6 Hooks 生命周期回归 S08（P1）

- **目标**：验证 hooks 在会话事件中正确触发和执行
- **输入**：hooks 配置 + 触发事件
- **输出**：hook 执行结果
- **DoD**：
  1. `PreToolUse` / `PostToolUse` hook 可触发
  2. Hook 失败不阻塞主循环
  3. `test/phase2Hooks.test.js` 通过
- **预估工时**：3 天

### 2.7 MCP 连接与调用回归 S09（P1）

- **目标**：验证 MCP server 发现、连接、工具调用、断线恢复
- **输入**：`.mcp.json` 配置 + stdio/http 传输
- **输出**：MCP 工具调用结果
- **DoD**：
  1. Stdio transport 可启动本地 MCP server
  2. `listTools` 返回工具列表
  3. `callTool` 执行并返回结果
  4. 连接断开后自动重连
  5. `test/phase2MCP.test.js` 通过
- **预估工时**：4 天

### 2.8 Memory 读写回归 S10（P1）

- **目标**：验证 memory 文件的读取与写入
- **输入**：memory 命令参数
- **输出**：CLAUDE.md / ZCODE.md 文件内容更新
- **DoD**：
  1. 可读取 `~/.zcode/CLAUDE.md` 和项目级 `CLAUDE.md`
  2. 可通过 `/memory` 命令编辑
  3. 多级 memory 正确合并到 system prompt
  4. `test/phase2Memory.test.js` 通过
- **预估工时**：2 天

### 2.9 Doctor/Update 回归 S12（P1）

- **目标**：让 doctor 输出完整诊断、update 检查版本
- **输入**：当前环境状态
- **输出**：诊断报告 / 更新可用信息
- **DoD**：
  1. doctor 输出 shell 环境、provider 配置、MCP 健康、文件权限
  2. update 可检查 GitHub Release 最新版本
  3. `test/phase2Doctor.test.js` 通过
- **预估工时**：3 天

### 2.10 Windows 安装脚本与 Release 产物（P1）

- **目标**：用户可通过一行命令安装 ZCode
- **输入**：PowerShell 安装命令
- **输出**：ZCode 可执行入口被放置到 PATH 中
- **DoD**：
  1. PowerShell 脚本从 GitHub Release 下载产物
  2. 解压到 `%LOCALAPPDATA%\ZCode\`
  3. 自动添加 PATH
  4. `zcode --version` 输出正确版本
- **预估工时**：4 天

### 2.11 品牌残留分域清理（P2）

- **目标**：按功能域分批清理非首层品牌残留
- **输入**：530 处残留列表
- **输出**：用户可见残留归零
- **DoD**：
  1. system prompt 中 Claude Code → ZCode
  2. 权限提示完全统一
  3. 错误信息与日志统一
  4. 品牌回归测试通过
- **预估工时**：5 天（分 3 批）

### 2.12 性能压测与优化（P2）

- **目标**：满足冷启动 ≤3s、会话恢复 ≤2s、200 轮无崩溃
- **输入**：压测脚本
- **输出**：性能报告
- **DoD**：
  1. 冷启动时间测量脚本完成
  2. 200 轮长会话稳定性验证通过
  3. 内存泄漏检测通过
- **预估工时**：4 天

---

## 3. 分阶段执行路线

> 总工期 22 周，分 5 个里程碑。每个里程碑有明确的入口条件（Gate-In）、交付物（Deliverables）和退出条件（Gate-Out）。
> 任务编号引用第 2 节（T2.x）。**依赖关系用 `→` 表示"必须先完成"。**

### Phase 0：基线冻结（第 1-2 周）

| 周 | 任务 | 依赖 | 输出 |
|----|------|------|------|
| W1 | T2.7 品牌批量替换（第 1 批：`src/constants/`、`src/utils/`、`src/config/`） | 无 | 已清理 ≥150 处残留 |
| W1 | T2.8 Phase 2 第一波回归（S01/S06/S02 完善） | 无 | 3 条场景绿色 |
| W2 | T2.7 品牌批量替换（第 2 批：`src/tools/`、`src/commands/`） | W1-T2.7 | 已清理 ≥350 处残留 |
| W2 | 冻结基线快照：`git tag v0.1.0-baseline` | W1 全部 | 标签已打 |

- **Gate-In**：当前 74/75 测试通过。
- **Gate-Out**：`v0.1.0-baseline` 标签存在；品牌残留 ≤180 处（从 530 降到 180）；S01/S02/S06 三条回归全绿。

---

### Phase 1：双线路收敛（第 3-6 周）

这是整个项目的关键路径，Anthropic `streamChat` 必须在此阶段完成。

| 周 | 任务 | 依赖 | 输出 |
|----|------|------|------|
| W3 | **T2.1 Anthropic streamChat 实现 — 基础请求/响应流** | Phase 0 完成 | 能发送单轮对话并收到流式文本 |
| W3 | T2.2 ProviderAdapter 补全 — `getCapabilities` + `validateConfig` | Phase 0 完成 | 两个新方法单测通过 |
| W4 | **T2.1 Anthropic streamChat — tool_use 事件处理** | W3-T2.1 | 工具调用能正确解析并回传 tool_result |
| W4 | T2.3 Settings Contract 全链路 — 5 层合并逻辑 + 文件 I/O | W3-T2.2 | `mergeSettingsLayers` 集成测试通过 |
| W5 | **T2.1 Anthropic streamChat — 错误重试/超时/abort** | W4-T2.1 | 3 种异常场景单测通过 |
| W5 | T2.4 Model 元数据统一 — configs.ts 双线路适配 | W3-T2.2 | `modelRegistry` 能同时查 anthropic/openai-compatible 模型 |
| W6 | **T2.1 Anthropic streamChat — 端到端集成验证** | W5-T2.1 | 用真实 API Key 完成 5 轮对话 |
| W6 | T2.8 Phase 2 第二波回归（S05/S11/S03） | W5 全部 | 6 条场景绿色（累计） |

- **Gate-In**：`v0.1.0-baseline` 标签存在。
- **关键里程碑 M1**（W6 结束）：Anthropic streamChat 端到端可用。
- **Gate-Out**：`ANTHROPIC_API_KEY` 配置后 `zcode -p "hello"` 能输出流式文本；`zcode models` 同时列出双线路模型；6 条回归场景绿色。

---

### Phase 2：能力对齐（第 7-12 周）

| 周 | 任务 | 依赖 | 输出 |
|----|------|------|------|
| W7 | T2.5 会话管理 — `--resume` / `--continue` 基础 | M1 达成 | 会话能写入/读取 `.zcode/` 目录 |
| W7 | T2.9 Hooks 系统验证 | M1 达成 | 默认 hooks pipeline 跑通 |
| W8 | T2.5 会话管理 — auto-compact / 上下文窗口管理 | W7-T2.5 | 超过 80% 窗口自动压缩，无数据丢失 |
| W8 | T2.10 MCP 协议验证 — stdio transport | M1 达成 | 本地 MCP server 连接成功 |
| W9 | T2.5 会话管理 — 多会话列表与切换 | W8-T2.5 | `--resume` 无参时展示会话列表 |
| W9 | T2.10 MCP 协议验证 — SSE/HTTP transport | W8-T2.10 | 远程 MCP server 连接成功 |
| W10 | T2.6 权限系统 Windows 适配 | W9-T2.5 | 文件/网络/Shell 权限在 Windows 正常弹窗 |
| W10 | T2.11 Agent/子任务验证 | W9 全部 | AgentTool 能嵌套调用 |
| W11 | T2.7 品牌批量替换（第 3 批：system prompt / 错误信息 / 日志） | W10-T2.6 | 品牌残留 ≤50 处 |
| W11 | T2.8 Phase 2 第三波回归（S04/S07/S08/S09/S10/S12） | W10 全部 | 12 条场景全绿 |
| W12 | 集成测试全量运行 + 修复 | W11 全部 | 0 失败 |
| W12 | 里程碑 M2 检查点 | W12 集成 | 签发 `v0.2.0-alpha` |

- **关键里程碑 M2**（W12 结束）：12 条核心场景全部通过；品牌残留 ≤50 处。
- **Gate-Out**：`v0.2.0-alpha` 标签；Windows 上所有 42+ 工具至少手动验证一次；会话恢复端到端可用。

---

### Phase 3：Windows 发布准备（第 13-18 周）

| 周 | 任务 | 依赖 | 输出 |
|----|------|------|------|
| W13-14 | TD-01 构建工具链统一（Bun → Node.js 完全兼容或双运行时方案） | M2 达成 | `npm start` 和 `bun start` 均可启动 |
| W13-14 | TD-04 测试运行器适配（消除 bun-only 测试依赖） | M2 达成 | 75+ 测试全部在 Node.js 下通过 |
| W15-16 | Windows 安装包制作（MSI 或 portable zip） | W14 完成 | 安装后 `zcode --help` 可用 |
| W15-16 | TD-02/TD-03 TypeScript 类型安全/导入路径修正 | W14 完成 | `tsc --noEmit` 0 错误 |
| W17 | T2.12 性能压测 | W16 完成 | 冷启动 ≤3s，200 轮稳定 |
| W18 | 全量回归 + Release Candidate 签发 | W17 完成 | `v0.3.0-rc1` |

- **关键里程碑 M3**（W18 结束）：Release Candidate 可安装可运行。
- **Gate-Out**：Windows 10/11 双版本安装验证；冷启动 ≤3s；0 崩溃回归。

---

### Phase 4：稳定性与发布（第 19-22 周）

| 周 | 任务 | 依赖 | 输出 |
|----|------|------|------|
| W19 | 文档编写（README / 快速上手 / 配置参考） | M3 达成 | docs/ 下 3 篇完整文档 |
| W19 | T2.7 品牌终扫（第 4 批：文档/注释/测试中的残留） | M3 达成 | 品牌残留 = 0 |
| W20 | 用户验收测试（UAT）— 邀请 3-5 名内测用户 | W19 完成 | 收集反馈清单 |
| W20 | 安全审计（依赖漏洞扫描 + 权限边界检查） | M3 达成 | 0 高危漏洞 |
| W21 | UAT 反馈修复 + 回归 | W20 完成 | 所有 P0 反馈修复 |
| W22 | 正式版发布 `v1.0.0` | W21 完成 | GitHub Release + 安装包 |

- **关键里程碑 M4**（W22 结束）：正式版 `v1.0.0` 发布。
- **Gate-Out**：`v1.0.0` 标签；安装包通过签名验证；文档在线可访问；0 已知 P0 缺陷。

---

### 3.6 关键路径与依赖图

```
Phase 0 (W1-W2)
  ├── T2.7 品牌第1/2批
  └── T2.8 第一波回归
        │
        ▼
Phase 1 (W3-W6) ─── 关键路径 ───
  ├── T2.1 Anthropic streamChat [4周，最长路径]
  │     W3: 基础流 → W4: tool_use → W5: 重试/超时 → W6: 端到端
  ├── T2.2 ProviderAdapter 补全 (W3)
  ├── T2.3 Settings 全链路 (W4, 依赖 T2.2)
  ├── T2.4 Model 元数据 (W5, 依赖 T2.2)
  └── T2.8 第二波回归 (W6)
        │
        ▼ M1: streamChat 可用
Phase 2 (W7-W12)
  ├── T2.5 会话管理 [3周]
  │     W7: 基础 → W8: auto-compact → W9: 多会话
  ├── T2.9 Hooks (W7)
  ├── T2.10 MCP (W8-W9)
  ├── T2.6 权限 Windows 适配 (W10)
  ├── T2.11 Agent 验证 (W10)
  ├── T2.7 品牌第3批 (W11)
  └── T2.8 第三波回归 (W11-W12)
        │
        ▼ M2: 12 场景全绿
Phase 3 (W13-W18)
  ├── TD-01/TD-04 构建/测试统一 (W13-14)
  ├── Windows 安装包 (W15-16)
  ├── TD-02/TD-03 类型修正 (W15-16)
  ├── T2.12 性能压测 (W17)
  └── RC 签发 (W18)
        │
        ▼ M3: RC 发布
Phase 4 (W19-W22)
  ├── 文档 + 品牌终扫 (W19)
  ├── UAT + 安全审计 (W20)
  ├── 修复 + 回归 (W21)
  └── v1.0.0 发布 (W22)
        │
        ▼ M4: 正式发布
```

### 3.7 并行度说明

- **最大并行任务数**：每周不超过 2 条任务同时推进（假设 1 人全职）。
- **可并行的独立任务对**：
  - T2.7（品牌清理）与 T2.8（回归测试）— 互不依赖
  - T2.9（Hooks）与 T2.10（MCP）— 互不依赖
  - TD-01（构建统一）与 TD-02（类型修正）— 互不依赖
- **不可并行的严格串行链**：
  - T2.1 各阶段（W3→W4→W5→W6）必须顺序执行
  - T2.5 各阶段（W7→W8→W9）必须顺序执行
  - 性能压测（T2.12）必须等构建统一完成后才有意义

---

## 4. 风险与难点预判

### 4.1 技术风险矩阵

| ID | 风险描述 | 概率 | 影响 | 触发条件 | 缓解策略 |
|----|----------|------|------|----------|----------|
| R1 | **Anthropic Messages API 流式协议复杂度超预期** | 高 | 致命 | 实现 `content_block_delta` 中 `tool_use` 嵌套时发现上游 SDK 行为与文档不一致 | 不依赖上游 SDK，直接对接 HTTP SSE 原始流（参考 `openaiCompatible.js` 已有的 SSE 解析模式）。提前编写 mock SSE 服务器用于离线开发 |
| R2 | **TypeScript / JavaScript 混合导入链断裂** | 高 | 严重 | Node.js `--experimental-strip-types` 对 `.ts` → `.js` 导入链的处理出现边界情况 | Phase 3 优先解决 TD-02/TD-03。在 Phase 1-2 阶段新增文件统一使用 `.js` 后缀 |
| R3 | **Bun ↔ Node.js 运行时不兼容** | 中 | 严重 | `bun:` 前缀 API、Bun-specific 全局变量、或 `bun test` 独有断言在 Node.js 下不存在 | 已知 1/75 测试因此失败（TD-04）。W13-14 专项修复。开发阶段仅用 `node --test` 运行测试 |
| R4 | **品牌替换引入功能回归** | 中 | 中等 | 正则替换误伤字符串模板或路径常量（如 `claude-code` 出现在 npm 包名、URL 路径中） | 每批替换后立即运行全量测试；使用 AST 级替换而非纯文本替换处理 `.ts`/`.tsx` 文件 |
| R5 | **Windows 路径分隔符问题** | 中 | 中等 | 源码中存在 hardcoded `/` 拼接的 Unix 路径，在 Windows 上 `fs.existsSync` 返回 false | 全局扫描 `path.join` 使用率，确保所有文件路径操作使用 `node:path` API。Phase 2 权限适配时重点关注 |
| R6 | **MCP 协议 transport 兼容性** | 低 | 中等 | stdio transport 在 Windows 的管道行为与 Linux 不同；SSE 连接被企业防火墙中断 | stdio: 使用 `child_process.spawn` 的 `pipe` 选项。SSE: 增加重连逻辑和超时配置 |
| R7 | **上游源码（Claude Code）版本迭代导致 diff 失效** | 低 | 严重 | Anthropic 发布新版本，修改了我们已修改的文件结构 | 锁定基线版本 v2.1.11；不追踪上游更新直到 v1.0.0 发布后 |
| R8 | **API Key 管理安全隐患** | 低 | 致命 | API Key 泄漏到日志、错误信息或 git 历史 | `providerEnvironment.js` 中所有 key 字段标记 `sensitive: true`；日志输出自动脱敏；`.env` 加入 `.gitignore` |

### 4.2 技术难点深度分析

#### 难点 1：Anthropic Messages API 流式 tool_use 处理（T2.1，难度 ★★★★★）

**问题本质**：Anthropic 的 `tool_use` 事件不是一次性返回完整 JSON，而是通过多个 `content_block_delta` 逐步发送 `input` 字段的 JSON 片段。需要：

1. **增量 JSON 拼接**：收到 `input_json_delta` 时追加到缓冲区
2. **content_block_stop 时解析**：只有在 `content_block_stop` 时才 `JSON.parse` 完整 input
3. **多工具并行**：一个 assistant 消息可能同时包含多个 `tool_use` block，需按 `index` 区分
4. **与 OpenAI 格式对齐**：最终输出必须统一为 `providerAdapter.normalizeToolCall` 所期望的格式

**参考实现**：`openaiCompatible.js` 中 `mergeToolCallDelta` 已实现了 OpenAI 格式的增量合并，可作为架构参考。Anthropic 格式的差异主要在于事件名称和嵌套层级。

**验证方法**：编写 mock SSE 服务器，重放录制的 Anthropic 流式响应，验证解析正确性。

#### 难点 2：会话持久化与 auto-compact（T2.5，难度 ★★★★☆）

**问题本质**：`QueryEngine.ts`（1295 行）中的会话循环已实现，但持久化逻辑依赖 `main.tsx` 中的 React 状态管理。需要：

1. **会话存储格式定义**：JSON 文件存储 messages 数组 + 元数据（model/provider/timestamp）
2. **auto-compact 触发条件**：当 token 使用量 > context_window × 0.8 时触发
3. **compact 策略**：调用模型生成摘要替换历史消息，保留最近 N 条完整消息
4. **恢复时重建状态**：从 JSON 恢复时需重建 tool_result 引用链

**风险点**：compact 后的摘要可能丢失关键上下文，导致后续工具调用失败。

#### 难点 3：530 处品牌残留的安全替换（T2.7，难度 ★★★☆☆）

**问题本质**：530 处残留分布在 250 个文件中，不能简单 sed 全量替换，因为存在以下陷阱：

1. **包名引用**：`@anthropic-ai/claude-code` 是 npm 包名，不能改
2. **API 端点**：`api.anthropic.com` 是实际 URL，不能改
3. **许可证/版权声明**：法律文本不应修改
4. **注释中的上下文引用**：`// based on Claude Code's implementation` 是合理注释
5. **变量名/函数名**：`claudeCodeProvider` 等需要改名，但影响调用方

**策略**：按文件类型分批，每批配有白名单。优先替换字面量字符串 > 变量名 > 注释 > 文档。

#### 难点 4：Windows 安装包与 PATH 注册（Phase 3，难度 ★★★☆☆）

**问题本质**：目标用户在 Windows 10/11 上使用，需要：

1. **Portable 模式**：解压即用，`zcode.cmd` 作为入口脚本
2. **PATH 自动注册**：安装后 `zcode` 命令全局可用
3. **Node.js 依赖打包**：用户机器可能无 Node.js，需考虑 bundled runtime 或 `pkg`/`sea` 方案
4. **Auto-update 机制**（可选 v1.1）：首版本可手动更新

### 4.3 外部依赖风险

| 依赖 | 当前版本 | 风险 | 应对 |
|------|----------|------|------|
| Node.js | ≥22 (strip-types) | `--experimental-strip-types` 仍为 experimental，未来 API 可能变化 | 锁定 Node.js 22.x LTS；若 flag 被移除则迁移至 `tsx` 或预编译 |
| Anthropic API | Messages v1 | API 变更导致流式协议不兼容 | 锁定 `anthropic-version: 2023-06-01` header |
| Ink (React TUI) | v5.x | 社区维护力度下降 | 核心渲染无深度定制需求，可冻结版本 |
| docx | ^9.7.1 | 仅用于文档生成，非核心依赖 | 低风险，保持现状 |

---

## 5. 测试与交付策略

### 5.1 测试金字塔

```
                    ┌───────────┐
                    │  E2E 测试  │  ← 5-10 条核心流程（真实 API）
                   ─┤           ├─
                  ┌─┴───────────┴─┐
                  │   集成测试      │  ← 12 条 Phase 2 回归场景（mock API）
                 ─┤               ├─
                ┌─┴───────────────┴─┐
                │     单元测试        │  ← 100+ 条（纯逻辑，无 I/O）
                └───────────────────┘
```

**目标覆盖率**：
- 单元测试：`src/providers/`、`src/config/`、`src/contracts/` 目录 ≥80% 行覆盖
- 集成测试：12 条场景 100% 通过
- E2E 测试：核心路径（启动 → 对话 → 工具调用 → 退出）通过

### 5.2 测试分层详述

#### 层 1：单元测试（node --test）

| 测试目标 | 文件位置 | 数量 | 运行方式 |
|----------|----------|------|----------|
| Provider 适配器规范 | `test/providers/*.test.js` | 20+ | `node --experimental-strip-types --test` |
| Settings 合并逻辑 | `test/config/*.test.js` | 15+ | 同上 |
| Brand 文本输出 | `test/brand/*.test.js` | 10+ | 同上 |
| Tool call 解析 | `test/tools/*.test.js` | 20+ | 同上 |
| Model registry | `test/models/*.test.js` | 10+ | 同上 |

**原则**：
- 每个单元测试文件对应一个源文件
- 不依赖网络、文件系统或环境变量（使用 mock）
- 运行时间 < 5 秒/文件

#### 层 2：集成测试（Phase 2 回归矩阵）

12 条核心场景，每条包含：

| 场景 ID | 描述 | 线路 | 验证方法 |
|---------|------|------|----------|
| S01 | 新会话初始化表面 | common | `readNewSessionSurface()` 返回正确品牌信息 |
| S02 | 会话恢复查找 | common | `runResumeSurface()` 找到已保存会话 |
| S03 | 单轮对话完成 | anthropic | streamChat 返回完整响应 |
| S04 | 多轮对话连续性 | anthropic | 第 N 轮能引用第 1 轮上下文 |
| S05 | Shell 权限表面 | common | `evaluatePermissionSurface('shell')` 正确弹窗 |
| S06 | Plan 模式启用 | common | `runPlanSurface()` 切换成功 |
| S07 | 工具调用执行 | anthropic | BashTool/FileReadTool 端到端 |
| S08 | 工具调用执行 | openai-compatible | 同上，验证双线路一致性 |
| S09 | Auto-compact 触发 | common | token 超限时自动压缩 |
| S10 | MCP 工具加载 | common | MCP server 注册的工具可被发现 |
| S11 | 权限 allow/deny 规则 | common | `createPermissionRule` 正确判定 |
| S12 | 错误恢复 | common | API 超时后自动重试成功 |

**运行方式**：`node --experimental-strip-types --test test/phase2*.test.js`

#### 层 3：E2E 测试（真实 API）

仅在 CI 的 `release` 分支或手动触发时运行，需要有效 API Key。

```bash
# 运行 E2E 测试（需设置环境变量）
ANTHROPIC_API_KEY=sk-xxx node --test test/e2e/*.test.js
OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=https://api.example.com node --test test/e2e/openai.test.js
```

### 5.3 持续集成流水线

```yaml
# .github/workflows/ci.yml 核心结构
name: ZCode CI
on: [push, pull_request]
jobs:
  unit-test:
    runs-on: windows-latest
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: node --experimental-strip-types --test test/unit/**/*.test.js

  integration-test:
    runs-on: windows-latest
    needs: unit-test
    steps:
      - run: node --experimental-strip-types --test test/phase2*.test.js

  brand-check:
    runs-on: windows-latest
    steps:
      - run: node scripts/brand-residual-scan.js
      - run: test $(cat brand-count.txt) -le 50  # Phase 2 后 ≤50

  e2e-test:
    runs-on: windows-latest
    if: github.ref == 'refs/heads/release'
    needs: integration-test
    steps:
      - run: node --test test/e2e/*.test.js
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### 5.4 交付物清单

| 里程碑 | 版本号 | 交付物 | 交付形式 |
|--------|--------|--------|----------|
| M1 (W6) | v0.1.1-dev | streamChat 可用的开发版 | git tag + 内部测试 |
| M2 (W12) | v0.2.0-alpha | 全场景通过的 Alpha 版 | git tag + portable zip |
| M3 (W18) | v0.3.0-rc1 | Release Candidate | GitHub Pre-release + MSI/zip |
| M4 (W22) | v1.0.0 | 正式版 | GitHub Release + 安装包 + 文档站 |

### 5.5 发布检查清单（v1.0.0 Gate）

- [ ] 12 条 Phase 2 回归场景全绿
- [ ] 单元测试 100+ 条全通过
- [ ] E2E 测试（Anthropic + OpenAI-compatible）通过
- [ ] 品牌残留扫描 = 0 处
- [ ] 冷启动时间 ≤ 3 秒
- [ ] 200 轮对话无崩溃/无内存泄漏
- [ ] Windows 10 + Windows 11 安装验证通过
- [ ] `zcode --help` / `zcode doctor` / `zcode models` 正确输出
- [ ] `.env` 配置 API Key 后 `zcode -p "hello"` 双线路响应正常
- [ ] README.md 包含快速上手指南
- [ ] CHANGELOG.md 记录所有变更
- [ ] 无已知 P0/P1 缺陷
- [ ] 依赖漏洞扫描 0 高危

### 5.6 版本号策略

采用语义化版本 `MAJOR.MINOR.PATCH`：

- **0.1.x**：基线阶段，仅内部使用
- **0.2.x**：Alpha 阶段，功能基本完整但可能不稳定
- **0.3.x**：RC 阶段，功能冻结，仅修 bug
- **1.0.0**：正式发布，对外承诺 API 稳定性

---

## 附录 A：术语表

| 术语 | 含义 |
|------|------|
| **双线路** | Anthropic（主线）+ OpenAI-compatible（独立线路）并存的 Provider 架构 |
| **品牌残留** | 代码中遗留的 "Claude"/"claude-code" 等原始品牌标识 |
| **Phase 2 回归矩阵** | 12 条核心验收场景（S01-S12），覆盖 common/anthropic/openai-compatible 三个线路标签 |
| **Gate-In / Gate-Out** | 阶段入口条件 / 阶段退出条件 |
| **auto-compact** | 当对话 token 接近上下文窗口上限时，自动调用模型生成摘要以压缩历史消息 |
| **ProviderAdapter** | 统一的 Provider 适配器接口，屏蔽不同 API 的协议差异 |
| **MCP** | Model Context Protocol，模型上下文协议，支持 stdio/SSE/HTTP 三种 transport |

---

> **文档结束**
> 总计 5 个章节 + 1 个附录。所有任务可直接按编号 T2.x 追踪；所有里程碑可按 M1-M4 对照检查。
