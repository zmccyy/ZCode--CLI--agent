# ZCode Windows Parity Development Plan

## Summary

本计划基于以下前提：

- 目标产品：ZCode
- 对标对象：Claude Code `v2.1.11` 同期公开的本地 CLI agent 核心能力
- 目标平台：Windows 10/11
- 团队规模：`3-5` 人
- 目标周期：`22` 周，允许在 `20-24` 周区间内微调
- 研发策略：路线 B，能力对齐 + 分层收敛

核心交付目标：

1. 将当前 `upstream/` 快照收敛为可发布的 ZCode 工程。
2. 在不重写主干的前提下，建立 provider、配置、品牌和发布边界。
3. 让 ZCode 在 Windows 下完成本地 CLI agent 核心任务闭环。
4. 通过量化验收标准验证“完成度接近 Claude Code 2.1.11”。

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

### Phase 1 · 核心解耦 · Week 3-6

目标：

- 把历史代码中的 provider、品牌、配置相关耦合抽离出来。

实施步骤：

1. 定义 `ProviderAdapter` 接口。
2. 定义 `ModelRegistry` 与 model metadata 结构。
3. 定义统一 settings schema 和优先级规则。
4. 将品牌相关常量统一改由 `BrandConfig` 提供。
5. 统一命令命名空间、欢迎页、帮助文案和产品常量。
6. 为现有 Anthropic 路径补 adapter 包装层。
7. 将 `openaiCompatible.js` 从测试桩扩展为真正可接入的 provider。

输出物：

- provider contract
- settings schema
- brand contract
- 兼容现有主链路的 adapter 层

完成标准：

- `ZCode` 主命名链路跑通
- 品牌残留开始可系统清理
- provider 接口可独立测试

### Phase 2 · 能力对齐 · Week 7-12

目标：

- 补齐本地 CLI 核心 agent 能力的一致性与稳定性。

实施步骤：

1. 检查并收敛 plan mode 行为。
2. 收敛 memory / session / resume 主链路。
3. 统一 tools 在不同 provider 下的 tool-calling 归一化逻辑。
4. 验证并修补 subagent / teammate 路径。
5. 验证 hooks 生命周期事件和执行边界。
6. 验证 MCP 发现、连接、调用和失败恢复。
7. 建立端到端任务集。

输出物：

- 核心能力回归用例
- provider capability matrix
- session / memory / tool 调用一致性修复

完成标准：

- Windows 下可以完成一条端到端编码任务
- 12 条核心场景中通过率达到 `>= 75%`
- 已识别的 blocker 能被稳定复现和修复

### Phase 3 · Windows 发布收口 · Week 13-18

目标：

- 把可运行能力收口成可安装、可更新、可诊断、可发布的 Windows 产品。

实施步骤：

1. 设计安装方式：
   - GitHub Release 下载产物
   - 终端安装脚本
2. 统一版本号、release notes、更新命令。
3. 完善 `doctor` 诊断项：
   - shell 环境
   - provider 配置
   - 文件权限
   - MCP 健康状态
   - Windows 终端兼容项
4. 补齐错误提示与自恢复建议。
5. 产出 Windows 安装、升级、卸载文档。

输出物：

- 安装脚本
- GitHub Release 产物
- update / doctor 收口
- Windows 用户文档

完成标准：

- Windows 安装和更新成功率达到 `>= 90%`
- 新用户可通过 release 或终端安装启动 ZCode
- doctor 能定位主要配置问题

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

- [QueryEngine.ts](D:\桌面\项目\agent壳\upstream\src\QueryEngine.ts)
- [sessionStorage.ts](D:\桌面\项目\agent壳\upstream\src\utils\sessionStorage.ts)
- [plans.ts](D:\桌面\项目\agent壳\upstream\src\utils\plans.ts)

### 模块 B：Provider & Settings

负责人建议：

- Integration Engineer

任务：

- 完成 `ProviderAdapter`
- 扩展 OpenAI-compatible provider
- 定义 model registry
- 统一 settings 合并与校验

关键文件起点：

- [openaiCompatible.js](D:\桌面\项目\agent壳\upstream\src\providers\openaiCompatible.js)
- [brandConfig.js](D:\桌面\项目\agent壳\upstream\src\config\brandConfig.js)

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

- [hooks command](D:\桌面\项目\agent壳\upstream\src\commands\hooks\index.ts)
- [agents command](D:\桌面\项目\agent壳\upstream\src\commands\agents\index.ts)

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

- [doctor command](D:\桌面\项目\agent壳\upstream\src\commands\doctor\index.ts)
- [release-notes command](D:\桌面\项目\agent壳\upstream\src\commands\release-notes\index.ts)

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

- Provider / Brand / Settings 三大抽象落地
- ZCode 命名主线跑通

### M3 · Week 12

- Windows 下完成主链路端到端任务
- 核心 agent 能力达到内部试用标准

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

1. 输出 capability matrix 与 gap list。
2. 定义 provider / brand / settings 三个 contract。
3. 设计 Windows release 方式与安装脚本方案。
4. 建立 12 条核心场景回归集。

## 备注

当前目录不是 git 工作区，因此本次计划文档已写入本地，但无法按规范完成提交记录与基于 commit 的 review 流程。
