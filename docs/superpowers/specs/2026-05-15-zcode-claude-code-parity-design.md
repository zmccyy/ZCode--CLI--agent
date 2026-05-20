# ZCode 对标 Claude Code 2.1.11 设计说明

## 文档类型

Explanation + design spec

## 目标

在现有 `ZCode/` 骨架基础上，以 Windows 10/11 为唯一目标平台，将 ZCode 的本地 CLI agent 核心能力提升到与 Claude Code `v2.1.11` 同期公开能力面相当的完成度，并形成可发布的 GitHub Release 与终端安装交付链路。

## 版本与资料说明

- 本次基线对标版本为 Claude Code `v2.1.11`。
- 该版本官方 GitHub release 发布时间为 `2026-01-17`。
- 公开 release note 很短，主要变更是修复 MCP 在 HTTP/SSE 传输下连接请求过多的问题。
- 因此，本设计不把单个 release note 视为完整能力清单，而是结合同一时期的官方公开文档建立能力基线。

## 官方能力基线

基于 `ctx7` 与官方公开资料，Claude Code 同期公开的本地 CLI agent 核心能力可归纳为以下几类：

### 1. CLI 交互与安装分发

- 支持终端内自然语言驱动的软件工程任务。
- 提供 Windows 安装方式，包括 PowerShell 安装脚本与 `winget` 安装。
- 具备 update / doctor / release notes 类命令和安装诊断能力。

来源：
- `ctx7` 官方库 `/anthropics/claude-code`
- 官方 README 安装片段
- GitHub releases 页面

### 2. 工具执行与代码工作流

- 具备文件读写、搜索、命令执行、代码编辑、Git 相关操作等本地工具能力。
- 通过工具调用驱动复杂任务链，而不是只做聊天回答。
- 支持权限控制与安全边界。

### 3. 上下文、会话与记忆

- 支持会话延续、状态恢复与持久化。
- 支持 agent memory，且官方后续文档显示存在 `user / project / local` 三层记忆范围。
- 支持上下文压缩或 compact 类能力，用于长会话可持续运行。

### 4. 计划、子代理与任务分解

- 支持 plan mode 或等价的先规划后执行约束。
- 支持 sub-agent / teammate / worker 型任务分派。
- 子代理能力可用于研究、实现、验证等分工场景。

### 5. Hooks 与 MCP 扩展

- 支持 hooks 生命周期事件。
- 支持 MCP server 集成，用于连接外部工具能力。
- 支持本地 CLI 运行时中的扩展能力接入。

### 6. 命令与扩展结构

- 官方公开了 commands / agents / skills / hooks / `.mcp.json` 组成的插件结构。
- 本项目当前阶段不对标完整插件生态，但需要保留与未来扩展兼容的边界。

## 当前代码库状态评估

### 总体判断

当前目录已经是 git 工作区，主体开发目录为 `ZCode/`，根目录同时保留规划文档与少量辅助文件。当前状态不再是“只有代码快照”，而是进入了基于现有骨架持续收口的工程阶段。

这意味着：

- 可以基于当前仓库直接持续迭代与提交。
- 不能把对标工作理解为“从零重写 agent”。
- 更合理的路线是在现有成熟骨架上进行 clean-room 品牌化、接口标准化、Windows 发布收口和能力验收建设。

### 已具备的强能力

通过代码盘点，当前 `upstream/` 已具备大量高完成度能力：

- `QueryEngine` 驱动主对话循环、消息流与工具调用。
- `commands.ts` 与 `src/commands/*` 提供丰富命令系统。
- `sessionStorage`、`history`、`transcriptSearch` 等组成会话与转录持久化能力。
- `src/commands/agents`、`coordinatorMode`、`teammateMailbox`、`swarm/*` 已具备子代理或多工作者骨架。
- `src/commands/hooks` 与 SDK hook schema 显示已有完整 hooks 事件体系。
- `src/components/mcp/*` 与 `services/mcp/*` 显示 MCP 管理、连接、授权与工具展示能力。
- `src/utils/permissions/*`、`Sandbox*`、`Permission*` 体系说明权限控制已较成熟。
- `src/utils/windowsPaths.ts`、安装/更新逻辑、doctor 命令说明已有 Windows 适配基础。

### 当前主要缺口

围绕 ZCode 产品化和对标目标，当前主要缺口不是“能力不存在”，而是“能力没有收敛成可发布的 ZCode 产品”：

- `BrandConfig` 已出现，但品牌替换仍是局部改造，历史耦合仍多。
- `openai-compatible` 已具备独立 runtime / request path 与定向测试，但更广泛的模型体系仍明显偏向 Anthropic 主路径。
- 根目录 `package.json` 过薄，当前不具备完整的构建、发布、安装和版本化链路。
- 缺少 ZCode 视角的 capability matrix、回归矩阵和量化验收标准。
- 缺少对 Windows-only 目标的明确收口策略。

## 设计结论

### 选定路线

采用路线 B：`能力对齐 + 分层收敛`

该路线的核心判断是：

- 保留现有 `QueryEngine`、tools、commands、MCP、hooks、subagent 骨架。
- 不做大规模重写。
- 通过新增明确的 provider 层、配置层、品牌层和发布层，把当前快照收敛成 ZCode 产品。
- 对高风险耦合点做定向重构，而不是全局翻修。

### 适用约束

- 对标范围：本地 CLI agent 核心能力
- 团队规模：`3-5` 人
- 交付目标：完成度优先
- 周期目标：`20-24` 周
- 平台范围：仅 Windows 10/11

### Phase 1 收口策略（2026-05-19 更新）

- 默认保留 `Anthropic` 与 `openai-compatible` 两条线路并行推进。
- `openai-compatible` 当前目标是“在显式配置下独立可运行”，而不是立刻替换或合并 Anthropic 主线。
- `ModelRegistry` / provider enum / default model 统一移出 Phase 1 完成定义，作为后续清理项保留。
- Phase 2 负责带线路标记的行为回归，Phase 3 负责双线文档、诊断和发布收口。

## 产品边界

### 本阶段必须进入范围

- 交互式 CLI 会话
- 文件/搜索/命令/编辑核心工具
- 计划模式
- session resume / transcript persistence
- memory
- subagent
- hooks
- MCP
- permission / sandbox policy
- provider 切换
- OpenAI-compatible provider 接入
- Windows 安装、更新、诊断与发布
- GitHub Release 下载与终端安装

### 本阶段明确排除

- IDE 深度集成
- GitHub / PR 自动化闭环
- 浏览器 GUI
- 远程 bridge / homespace / SaaS
- 团队协作后台
- 插件市场生态
- 多租户服务端

## 目标架构

推荐采用五层结构。

### 1. CLI Shell Layer

职责：

- CLI 入口
- slash commands
- Ink 交互层
- doctor / update / help / release notes
- Windows 终端适配

原则：

- 用户可见的行为、提示文案、命令命名统一从 ZCode 产品层出发。

### 2. Core Runtime Layer

职责：

- `QueryEngine` 会话主循环
- plan mode
- context compaction
- tool orchestration
- session / transcript / memory
- permission policy
- error recovery

原则：

- 不重写主干。
- 通过包装、抽象和裁剪降低与上层 CLI 及下层 provider 的直接耦合。

### 3. Extension Layer

职责：

- built-in tools
- skills / prompt loading
- hooks
- MCP clients
- subagent / teammate execution

原则：

- 先保留行为兼容，再逐步标准化接口与注册机制。

### 4. Provider Layer

职责：

- Anthropic adapter
- OpenAI-compatible adapter
- model registry
- capability normalization
- model metadata / context window / tool-calling support

核心接口建议：

```ts
type ProviderAdapter = {
  id: string
  streamChat(input: StreamChatInput): AsyncGenerator<ProviderChunk>
  listModels(): Promise<ModelDescriptor[]>
  getCapabilities(model: string): ProviderCapabilities
  normalizeToolCalls(raw: unknown): NormalizedToolCall[]
  validateConfig(config: ProviderConfig): ProviderConfig
}
```

### 5. Brand & Distribution Layer

职责：

- `BrandConfig`
- logo / theme / welcome copy / product constants
- installer / updater / release packaging
- GitHub release assets
- docs / changelog / install guide

原则：

- 让品牌替换成为配置与资源问题，而不是散落在运行时代码中的字符串替换问题。

## 核心架构原则

### 原则 1：不重写 QueryEngine 主干

`QueryEngine` 已经是成熟主循环。现阶段应优先包裹与抽象，而不是为了“更干净”而推倒重来。

### 原则 2：优先保证双线路独立可运行，统一模型体系后置

如果为了抽象整洁强行合并 provider / model 系统，会拖慢当前 Phase 1。更合理的做法是先保证 Anthropic 主线与 `openai-compatible` 线路都能独立工作，再在后续阶段评估统一模型体系。

### 原则 3：Windows-first

当前唯一目标平台是 Windows 10/11，因此所有命令、路径、安装、更新、shell 行为和测试矩阵都应优先围绕 Windows 设计。

## 风险判断

### 风险 1：QueryEngine 与 CLI / permissions / storage 耦合深

影响：

- 改动 provider 或 plan mode 时，容易回归到 permission、session、UI 输出。

缓解：

- 建立集成测试基线。
- 通过 adapter / facade 包装耦合点。
- 避免单次跨多个高风险域的重构。

### 风险 2：OpenAI-compatible 厂商能力不一致

影响：

- tool-calling、streaming、JSON schema、stop reasons 行为可能不同。

缓解：

- 建 capability matrix。
- provider 层内置降级策略。
- 先支持少数受控 provider，再逐步扩展。

### 风险 3：Windows 环境差异

影响：

- PowerShell、CMD、Git Bash、Windows Terminal 行为不一致。

缓解：

- 设计中将安装、update、doctor 提前纳入中期里程碑。
- 建立 Windows 终端兼容回归清单。

## 设计结论

对于本项目，最合理的方案不是“重建一个全新 agent”，而是：

1. 基于现有成熟骨架保留已验证能力。
2. 通过分层收敛完成 ZCode 产品化。
3. 以 Windows 发布与验收为中心重建工程化交付链路。
4. 用量化能力矩阵和回归矩阵验证是否达到目标完成度。

## 参考来源

- [Claude Code 官方仓库](https://github.com/anthropics/claude-code)
- [Claude Code v2.1.11 Release](https://github.com/anthropics/claude-code/releases/tag/v2.1.11)
- `ctx7` 官方文档库：`/anthropics/claude-code`
- 当前代码库关键位置：
  - [QueryEngine.ts](D:\桌面\项目\agent壳\ZCode\src\QueryEngine.ts)
  - [brandConfig.js](D:\桌面\项目\agent壳\ZCode\src\config\brandConfig.js)
  - [openaiCompatible.js](D:\桌面\项目\agent壳\ZCode\src\providers\openaiCompatible.js)
  - [runtime.js](D:\桌面\项目\agent壳\ZCode\src\providers\runtime.js)
  - [commands.ts](D:\桌面\项目\agent壳\ZCode\src\commands.ts)
  - [agents command](D:\桌面\项目\agent壳\ZCode\src\commands\agents\index.ts)
  - [hooks command](D:\桌面\项目\agent壳\ZCode\src\commands\hooks\index.ts)
  - [doctor command](D:\桌面\项目\agent壳\ZCode\src\commands\doctor\index.ts)
