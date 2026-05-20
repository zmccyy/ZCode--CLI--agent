# ZCode Windows Parity Development Plan

## Summary

本计划基于以下前提：

- 目标产品：ZCode
- 对标对象：Claude Code `v2.1.11` 同期公开的本地 CLI agent 核心能力
- 目标平台：Windows 10/11
- 团队规模：`3-5` 人
- 目标周期：`22` 周，允许在 `20-24` 周区间内微调
- 研发策略：路线 B，双线并行 + 分层收口

核心交付目标：

1. 将当前 `upstream/` 快照收敛为可发布的 ZCode 工程。
2. 在不重写主干的前提下，建立 provider、配置、品牌和发布边界。
3. 让 ZCode 在 Windows 下完成本地 CLI agent 核心任务闭环。
4. 通过量化验收标准验证“完成度接近 Claude Code 2.1.11”。

Phase 1 的默认前提：

- `Anthropic` 与 `openai-compatible` 两条线路并行推进。
- 不把 provider / model 全量合并作为当前阶段目标。
- `ModelRegistry` / provider enum / default model 统一作为后续清理项保留。

## 阶段划分

### Phase 0 · 基线冻结 · Week 1-2

目标：

- 冻结需求边界、能力基线和风险边界。

实施步骤：

1. 建立 Claude Code 能力矩阵。
2. 建立当前仓库能力矩阵。
3. 形成 gap list，按 `P0 / P1 / P2` 分级。
4. 冻结目标架构与模块边界。
5. 建立 Windows 回归矩阵初版。

输出物：

- 能力对照矩阵
- 风险清单
- 目标架构图
- 验收标准草案

完成标准：

- P0 gap 全部明确归属
- 架构与范围不再大改
- 关键命令与主链路盘点完成

### Phase 1 · 双线收口 · Week 3-6

目标：

- 在不强推 provider / model 全量合并的前提下，收口 Anthropic 与 `openai-compatible` 两条运行线路，以及品牌、配置边界。

实施步骤：

1. 固化 `ProviderAdapter`、`settingsContract`、`BrandConfig` 的最小公共 contract。
2. 维持 Anthropic 作为默认主线，补齐其 runtime / adapter 包装边界。
3. 维持 `openai-compatible` 作为独立线路，确保配置、超时、provider 选择和 request path 可单独运行。
4. 仅在公共入口统一 provider 选择、配置读取和错误边界，不强推 model metadata / provider enum 合并。
5. 清理第一批用户可见品牌残留。
6. 为两条线路建立最小支持矩阵与非目标说明。
7. 将 model system unification 记录为 Phase 2 之后再评估的清理项。

输出物：

- 双线路 runtime 边界
- settings / brand contract
- provider mode 选择逻辑
- Phase 2 回归所需 support matrix

完成标准：

- Anthropic 主线继续跑通 `ZCode` 主命名链路
- `openai-compatible` 可在显式配置下独立运行
- provider mode 切换与关键配置项有自动化验证
- model system unification 被明确记录为非 Phase 1 blocker

### Phase 2 · 能力对齐 · Week 7-12

目标：

- 在双线并行前提下，补齐本地 CLI 核心 agent 能力的一致性与稳定性。

实施步骤：

1. 检查并收敛 plan mode 行为。
2. 收敛 memory / session / resume 主链路。
3. 分别验证 Anthropic / `openai-compatible` 下的 tool-calling、streaming 与错误映射；仅在 adapter 层做最小归一化。
4. 验证并修补 subagent / teammate 路径。
5. 验证 hooks 生命周期事件和执行边界。
6. 验证 MCP 发现、连接、调用和失败恢复。
7. 建立带“适用线路”标签的端到端任务集。

输出物：

- 核心能力回归用例
- 双线 provider capability / support matrix
- session / memory / tool 调用一致性修复

完成标准：

- Windows 下 Anthropic 主线可以完成一条端到端编码任务
- `12` 条核心场景具备线路标记且整体通过率达到 `>= 75%`
- `openai-compatible` 完成其范围内的独立 provider / runtime 回归
- 已识别的 blocker 能被稳定复现和修复

### Phase 3 · Windows 发布收口 · Week 13-18

目标：

- 把双线能力收口成可安装、可更新、可诊断、可发布的 Windows 产品。

实施步骤：

1. 设计安装方式：
   - GitHub Release 下载产物
   - 终端安装脚本
2. 统一版本号、release notes、更新命令，并明确对外支持矩阵。
3. 完善 `doctor` 诊断项：
   - shell 环境
   - Anthropic / `openai-compatible` provider 配置
   - 文件权限
   - MCP 健康状态
   - Windows 终端兼容项
4. 补齐错误提示与自恢复建议。
5. 产出 Windows 安装、升级、卸载文档，以及双线路配置说明。

输出物：

- 安装脚本
- GitHub Release 产物
- update / doctor 收口
- Windows 用户文档与双线路配置说明

完成标准：

- Windows 安装和更新成功率达到 `>= 90%`
- 新用户可通过 release 或终端安装启动 ZCode 的 Anthropic 默认主线
- `openai-compatible` 可按文档完成配置并通过 doctor / 连通性检查
- 发布说明能明确呈现支持矩阵与限制

### Phase 4 · 性能与稳定性 · Week 19-22

目标：

- 在长会话、大仓库和高频工具调用场景下达到可发布稳定性。

实施步骤：

1. 长会话压测与 context compaction 验证。
2. 大仓库搜索、读写、命令执行性能压测。
3. MCP 连接异常与恢复场景压测。
4. 工具失败重试、权限拒绝、session resume 压测。
5. RC 缺陷清理与发布前回归。

输出物：

- RC 版本
- 性能报告
- 缺陷清单与收敛记录

完成标准：

- 冷启动 `<= 3s`
- 最近会话恢复 `<= 2s`
- 长会话 `200` 轮内无致命状态损坏
- 安装与更新成功率 `>= 95%`

## 模块开发路径

### 模块 A：Core Runtime

负责人建议：

- Tech Lead
- Runtime Engineer

任务：

- 包装 `QueryEngine`
- 收敛 plan mode
- 统一 memory / session / resume
- 定义 error recovery 入口

关键文件起点：

- [QueryEngine.ts](D:\桌面\项目\agent壳\ZCode\src\QueryEngine.ts)
- [sessionStorage.ts](D:\桌面\项目\agent壳\ZCode\src\utils\sessionStorage.ts)
- [plans.ts](D:\桌面\项目\agent壳\ZCode\src\utils\plans.ts)

### 模块 B：Provider & Settings

负责人建议：

- Integration Engineer

任务：

- 完成双线路 provider runtime 收口
- 维持 `openai-compatible` 独立线路可运行
- 记录 model registry / provider enum 统一的后续清理边界
- 统一 settings contract 与校验

关键文件起点：

- [runtime.js](D:\桌面\项目\agent壳\ZCode\src\providers\runtime.js)
- [openaiCompatible.js](D:\桌面\项目\agent壳\ZCode\src\providers\openaiCompatible.js)
- [settingsContract.js](D:\桌面\项目\agent壳\ZCode\src\config\settingsContract.js)
- [brandConfig.js](D:\桌面\项目\agent壳\ZCode\src\config\brandConfig.js)

### 模块 C：Extension & Security

负责人建议：

- Runtime Engineer
- Integration Engineer

任务：

- hooks 可用性验证
- MCP 生命周期与故障恢复
- subagent / teammate 路径收敛
- permission policy 行为验证

关键文件起点：

- [hooks command](D:\桌面\项目\agent壳\ZCode\src\commands\hooks\index.ts)
- [agents command](D:\桌面\项目\agent壳\ZCode\src\commands\agents\index.ts)

### 模块 D：Brand & Release

负责人建议：

- Release / QA Engineer
- PM / Tech Writer

任务：

- 清理品牌残留
- 统一安装与更新
- 建立 GitHub Release 流程
- 编写安装、升级、诊断文档

关键文件起点：

- [doctor command](D:\桌面\项目\agent壳\ZCode\src\commands\doctor\index.ts)
- [release-notes command](D:\桌面\项目\agent壳\ZCode\src\commands\release-notes\index.ts)

## 资源分配建议

### 最小可行配置

- Tech Lead / Architect ×1
- Runtime Engineer ×1
- Integration Engineer ×1

### 推荐配置

- Tech Lead / Architect ×1
- Runtime Engineer ×1
- Integration Engineer ×1
- Release / QA Engineer ×1
- PM / Tech Writer ×0.5-1

## 关键里程碑

### M1 · Week 2

- 需求、能力矩阵、目标架构、风险矩阵、验收标准冻结

### M2 · Week 6

- Anthropic / `openai-compatible` 双线路 runtime 与 Brand / Settings 边界收口
- 明确 model system unification 后置，不阻塞继续推进

### M3 · Week 12

- Windows 下 Anthropic 主线完成端到端任务
- `openai-compatible` 完成范围内回归并形成 support matrix

### M4 · Week 18

- 安装、更新、doctor、release candidate 成型

### M5 · Week 22

- 通过性能与稳定性验收
- 发布 `v1.0.0` Windows 版本

## 量化验收标准

### 功能验收

至少覆盖以下 `12` 条核心场景：

1. 新建会话并开始任务
2. 恢复最近会话
3. 文件读取与搜索
4. 文件编辑与保存
5. 命令执行
6. plan mode
7. subagent 任务分派
8. hooks 触发与结果处理
9. MCP server 连接与调用
10. memory 读写
11. permission prompt / deny / allow
12. doctor / update 主链路

补充要求：

- 每条场景都要标注 `common / anthropic / openai-compatible` 适用线路。
- Anthropic 主线覆盖完整主链路场景，`openai-compatible` 至少覆盖其承诺支持的场景。

要求：

- 通过率 `>= 90%`

### 兼容性验收

Windows 10/11 下覆盖：

- PowerShell
- Windows Terminal
- Git Bash

要求：

- 安装、启动、执行、更新、卸载回归通过

### 性能验收

- 冷启动 `<= 3s`
- 最近会话恢复 `<= 2s`
- 工具调用链失败恢复成功率 `>= 80%`
- 长会话 `200` 轮内无致命状态损坏

### 稳定性验收

- RC 阶段 blocker 缺陷为 `0`
- P1 缺陷 `<= 3`
- 安装与更新成功率 `>= 95%`
- 用户可见品牌残留为 `0`

## 风险与对应策略

### 技术风险

- 主循环耦合深
- provider 差异大
- Windows shell 与路径差异多

策略：

- 小步迭代，分阶段抽象
- provider capability matrix + degrade policy
- 提前建设 Windows 回归矩阵

### 进度风险

- 中后期再补 installer / update / doctor 容易拖延

策略：

- 将产品化链路提前到 Phase 3，而不是最后一周补齐

### 质量风险

- 如果没有端到端任务集，容易“模块都能跑，但产品不能用”

策略：

- 从 Phase 2 开始维护固定的 E2E 任务集

## 建议的近期行动

按优先级，下一步应立即做：

1. 更新 capability matrix、gap list 与 Phase 1 双线支持矩阵。
2. 固化 provider / brand / settings 的最小公共 contract 与边界说明。
3. 设计 Windows release 方式与安装脚本方案。
4. 建立带线路标记的 12 条核心场景回归集。

## 备注

当前目录已是 git 工作区；后续计划更新可直接随实现一起提交并复核。
