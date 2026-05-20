# ZCode Gap List

## Scope

本文档用于补齐 Phase 0 所需的 `gap list`，并按 `P0 / P1 / P2` 进行分级。

评估原则：

- `P0`：阻塞 ZCode 主链路跑通或阻塞后续阶段的基础能力缺口
- `P1`：不阻塞主链路，但会显著影响完成度、稳定性或 Windows 可用性
- `P2`：可以后置优化的工程化或体验问题

## P0

### 1. 双线路 provider runtime 收口仍未完成

- 现状：`ProviderAdapter` contract、`runtime.js`、`openaiCompatible.js`、`providerAdapterClient.ts` 已具备最小可运行骨架，`openai-compatible` 已能通过运行时切换独立工作。
- 风险：如果继续按“先完成 provider / model 统一合并”推进，会把 Phase 1 重新拉回高风险的大改造。
- 当前进展：Anthropic / `openai-compatible` 已出现两条可识别路径，但主链路消费边界、支持矩阵和验收口径还未完全写清。
- 下一步：
  - 固化 Anthropic 主线与 `openai-compatible` 线路各自的 runtime / config 边界
  - 仅对公共入口做最小 contract 收口，暂不把 `ModelRegistry` / provider enum 全量统一作为 Phase 1 完成条件

### 2. 缺少 Phase 2 所需的核心场景回归集

- 现状：当前只有少量 contract tests，没有覆盖计划中的 12 条核心场景。
- 风险：模块能跑，但产品不可用的问题无法尽早发现。
- 当前进展：已扩展 16 条轻量 contract tests。
- 下一步：
  - 把 12 条核心场景拆成可执行测试清单
  - 先从 `新会话 / resume / 文件操作 / 命令执行 / plan mode` 开始

### 3. 品牌抽离仍然局部化

- 现状：`brandConfig.js`、`product.ts` 与公共入口首层文案已经完成第一轮收口，欢迎区、Help / General、Remote Control 首层提示、IDE onboarding、bridge 状态文案与 update 用户提示已切到 `ZCode` 视角。
- 剩余风险：仓库内仍有大量非 Phase 1 范围的历史 `Claude Code` / `Anthropic` 文案，主要分布在系统提示、远程 Web 能力、GitHub workflow 常量与兼容层实现中。
- 证据：
  - `ZCode/src/constants/system.ts`
  - `ZCode/src/constants/prompts.ts`
  - `ZCode/src/commands/review.ts`
  - `ZCode/src/commands/ultraplan.tsx`
- 结论：该项不再作为 Phase 1 blocker，后续按“用户直接可见且属于下一阶段功能入口”的优先级继续清理。

### 4. 缺少 ZCode 视角的 settings contract 收口

- 现状：现有 settings schema 很完整，但仍是 Claude Code 的历史 schema。
- 风险：ZCode 的 provider / brand / release 相关配置缺少明确契约，后续改造会继续散落。
- 当前进展：已新增 `settingsContract.js` 作为优先级与合并规则的最小 contract。
- 下一步：
  - 定义 ZCode 自己需要的 settings 子集
  - 判断哪些字段保留兼容，哪些字段应通过品牌层封装

## P1

### 5. OpenAI-compatible 线路已可运行，但支持边界与验收口径未固化

- 现状：`openai-compatible` 已接入 runtime / provider adapter client，并通过定向测试验证。
- 风险：如果不明确它当前是“独立线路”而不是“已完成全系统合并”，Phase 2 / 3 容易出现错误预期。
- 下一步：
  - 明确支持的配置项、模型选择方式和非目标范围
  - 为 Phase 2 回归用例补“适用线路”标记

### 6. Windows 安装、更新、诊断尚未形成 ZCode 交付链路

- 现状：代码里有 `doctor` 和 `update`，但没有 ZCode 级 release 工程。
- 风险：Phase 3 容易被拖到最后，导致可运行但不可发布。
- 下一步：
  - 提前设计 release 产物
  - 确认安装脚本、更新命令和版本策略

### 7. hooks / MCP / subagent 仍缺行为级验证

- 现状：代码骨架完整，但暂无 ZCode 视角验收。
- 风险：高复杂度路径在 Windows 环境下容易隐藏 blocker。
- 下一步：
  - 抽样建立行为回归
  - 先验证最短主链路，再补失败恢复场景

## P2

### 8. Model metadata / provider enum 统一仍未完成

- 现状：`utils/model/configs.ts`、`modelStrings.ts`、`modelCapabilities.ts` 仍是历史分散实现。
- 风险：后续扩展更多 provider 时，模型信息仍可能继续分叉，但当前不阻塞两线并行。
- 下一步：
  - 在 Phase 2 / 3 收口后再评估 `ModelRegistry` 与现有 model configs 的归一方案
  - 决定 registry 是 facade 还是新的唯一入口

### 9. 计划文档与实现进度尚未形成持续同步机制

- 现状：有设计和开发计划，但缺少阶段性实现记录。
- 风险：后续开发容易偏离原定阶段目标。
- 下一步：
  - 每完成一个阶段的最小增量，就更新 capability matrix 与 gap list

### 10. 根级测试仍偏轻量

- 现状：当前测试适合 contract 层，不足以覆盖复杂交互。
- 风险：只能发现边界错误，难以及时发现链路回归。
- 下一步：
  - 在不引入过重依赖的前提下，逐步补集成层验证

## Current Recommendation

按优先级，建议继续这样推进：

1. 进入 Phase 2，建立带“适用线路”标记的 12 条核心场景回归清单和实现顺序。
2. 提前设计 Windows release / install / doctor 的收口方案，为 Phase 3 减压。
3. 将剩余非公共入口的品牌残留按功能域分批处理，而不是继续做全仓字符串清扫。
4. 将 model system unification 明确记录为后续清理项，而不是当前 blocker。
