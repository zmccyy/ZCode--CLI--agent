# ZCode Gap List

## Scope

本文档用于补齐 Phase 0 所需的 `gap list`，并按 `P0 / P1 / P2` 进行分级。

评估原则：

- `P0`：阻塞 ZCode 主链路跑通或阻塞后续阶段的基础能力缺口
- `P1`：不阻塞主链路，但会显著影响完成度、稳定性或 Windows 可用性
- `P2`：可以后置优化的工程化或体验问题

## P0

### 1. 缺少统一的 Provider contract 主链路接入

- 现状：已存在多套 provider 相关逻辑，`openaiCompatible.js` 原本只是薄桩。
- 风险：继续直接加 provider 会扩大历史耦合，影响后续能力对齐。
- 当前进展：已新增 `ProviderAdapter` contract 和 `ModelRegistry` 最小实现。
- 下一步：
  - 为 Anthropic 主路径补一层 adapter 包装
  - 确认主链路如何消费统一的 provider capabilities / model metadata

### 2. 缺少 Phase 2 所需的核心场景回归集

- 现状：当前只有少量 contract tests，没有覆盖计划中的 12 条核心场景。
- 风险：模块能跑，但产品不可用的问题无法尽早发现。
- 当前进展：已扩展 16 条轻量 contract tests。
- 下一步：
  - 把 12 条核心场景拆成可执行测试清单
  - 先从 `新会话 / resume / 文件操作 / 命令执行 / plan mode` 开始

### 3. 品牌抽离仍然局部化

- 现状：`brandConfig.js` 和 `product.ts` 已存在，但大量 `Claude Code` / `Anthropic` 文案残留在系统提示、帮助文案和 GitHub workflow 常量中。
- 风险：无法达到计划中的“用户可见品牌残留为 0”。
- 证据：
  - `ZCode/src/constants/system.ts`
  - `ZCode/src/constants/prompts.ts`
  - `ZCode/src/constants/github-app.ts`
  - `ZCode/src/utils/attribution.ts`
- 下一步：
  - 建立品牌残留清单
  - 优先清理用户可见路径和产品常量

### 4. 缺少 ZCode 视角的 settings contract 收口

- 现状：现有 settings schema 很完整，但仍是 Claude Code 的历史 schema。
- 风险：ZCode 的 provider / brand / release 相关配置缺少明确契约，后续改造会继续散落。
- 当前进展：已新增 `settingsContract.js` 作为优先级与合并规则的最小 contract。
- 下一步：
  - 定义 ZCode 自己需要的 settings 子集
  - 判断哪些字段保留兼容，哪些字段应通过品牌层封装

## P1

### 5. OpenAI-compatible provider 尚未真正接入运行时

- 现状：本轮只完成了独立 contract 和标准化测试。
- 风险：无法证明 provider abstraction 真的可服务主链路。
- 下一步：
  - 接入 provider 选择逻辑
  - 对 model strings / tool call normalization 做运行时验证

### 6. Model metadata 仍未统一进入现有模型体系

- 现状：`utils/model/configs.ts`、`modelStrings.ts`、`modelCapabilities.ts` 仍是历史分散实现。
- 风险：后续 provider 扩展时，模型信息会继续分叉。
- 下一步：
  - 明确 `ModelRegistry` 与现有 model configs 的边界
  - 决定 registry 是 facade 还是新的唯一入口

### 7. Windows 安装、更新、诊断尚未形成 ZCode 交付链路

- 现状：代码里有 `doctor` 和 `update`，但没有 ZCode 级 release 工程。
- 风险：Phase 3 容易被拖到最后，导致可运行但不可发布。
- 下一步：
  - 提前设计 release 产物
  - 确认安装脚本、更新命令和版本策略

### 8. hooks / MCP / subagent 仍缺行为级验证

- 现状：代码骨架完整，但暂无 ZCode 视角验收。
- 风险：高复杂度路径在 Windows 环境下容易隐藏 blocker。
- 下一步：
  - 抽样建立行为回归
  - 先验证最短主链路，再补失败恢复场景

## P2

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

1. 将 `ProviderAdapter / ModelRegistry / settingsContract` 接入更靠近主链路的位置。
2. 清理第一批用户可见品牌残留。
3. 建立 12 条核心场景回归清单和实现顺序。
4. 提前设计 Windows release / install / doctor 的收口方案。
