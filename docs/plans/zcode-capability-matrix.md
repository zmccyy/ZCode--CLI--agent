# ZCode Capability Matrix

## Scope

本文档用于补齐 `zcode-windows-parity-development-plan.md` 中 Phase 0 缺失的“能力对照矩阵”输出物。

评估基线：

- 目标产品：`ZCode`
- 当前代码目录：`ZCode/`
- 对标范围：本地 CLI agent 核心能力
- 当前评估日期：`2026-05-16`

状态定义：

- `Present`：代码中已有明确实现入口
- `Partial`：有骨架或局部实现，但未完成 ZCode 产品化收敛
- `Missing`：当前仓库内未见足够实现或尚未收敛成可用能力
- `Verified`：已通过当前轻量测试或明确读码验证

## Matrix

| 能力域 | 目标能力 | 当前状态 | 证据 | 备注 |
| --- | --- | --- | --- | --- |
| CLI 会话 | 新建交互式会话 | Present | `ZCode/src/main.tsx`, `ZCode/src/QueryEngine.ts` | 主链路存在，但未做 ZCode 端到端验收 |
| CLI 会话 | 恢复最近会话 | Present | `ZCode/src/commands/resume/index.ts`, `ZCode/src/utils/sessionStorage.ts` | 需要 Windows 回归 |
| 文件工具 | 文件读取与搜索 | Present | `ZCode/src/tools/*`, `ZCode/src/utils/fileRead.ts`, `ZCode/src/utils/ripgrep.ts` | 需纳入核心场景回归 |
| 文件工具 | 文件编辑与保存 | Present | `ZCode/src/tools/*`, `ZCode/src/utils/filePersistence/*` | 需补验收用例 |
| 命令执行 | Shell / PowerShell 执行 | Present | `ZCode/src/utils/Shell.ts`, `ZCode/src/utils/shell/*`, `ZCode/src/tools/PowerShellTool/*` | Windows-first 基础较强 |
| 计划模式 | plan mode | Present | `ZCode/src/commands/plan/index.ts`, `ZCode/src/utils/plans.ts` | 行为一致性未验收 |
| 子代理 | subagent / teammate | Present | `ZCode/src/commands/agents/index.ts`, `ZCode/src/utils/swarm/*` | 需按 Phase 2 专项验证 |
| Hooks | 生命周期 hooks | Present | `ZCode/src/commands/hooks/index.ts`, `ZCode/src/utils/hooks/*` | 需验证边界和失败恢复 |
| MCP | MCP 发现/连接/调用 | Present | `ZCode/src/commands/mcp/index.ts`, `ZCode/src/services/mcp/*` | 需 Windows 兼容回归 |
| Memory | memory 读写 | Present | `ZCode/src/commands/memory/index.ts`, `ZCode/src/utils/memory/*`, `ZCode/src/memdir/*` | 需场景回归 |
| 权限控制 | permission prompt / deny / allow | Present | `ZCode/src/utils/permissions/*` | 需形成稳定回归集 |
| 压缩上下文 | compact / context compaction | Present | `ZCode/src/commands/compact/index.ts`, `ZCode/src/services/compact/*` | 需长会话压测 |
| Provider | Anthropic 主路径 | Present | `ZCode/src/utils/model/*`, `ZCode/src/services/api/*` | 历史主路径仍有耦合 |
| Provider | OpenAI-compatible provider | Partial | `ZCode/src/providers/openaiCompatible.js` | 本轮已补最小 contract，但未接入主链路 |
| Provider | 统一 ProviderAdapter contract | Partial | `ZCode/src/contracts/providerAdapter.js` | 本轮新增，尚未推广到 Anthropic 路径 |
| Model | ModelRegistry / metadata | Partial | `ZCode/src/providers/modelRegistry.js`, `ZCode/src/utils/model/configs.ts` | 仅完成独立 contract，未接主链路 |
| Settings | 统一 settings schema | Present | `ZCode/src/utils/settings/types.ts`, `ZCode/src/utils/settings/settings.ts` | 现有 schema 很完整，但仍是 Claude Code 语义 |
| Settings | settings 优先级 contract | Partial | `ZCode/src/config/settingsContract.js` | 本轮新增，尚未替换现有实现 |
| Brand | 品牌配置抽离 | Partial | `ZCode/src/config/brandConfig.js`, `ZCode/src/constants/product.ts` | 仅覆盖少量常量 |
| Doctor | 诊断命令 | Present | `ZCode/src/commands/doctor/index.ts` | 需面向 Windows 用户收口 |
| Update | 更新命令 | Present | `ZCode/src/cli/update.ts` | 需结合 release 流程验证 |
| 发布 | 安装脚本 / Release 产物 | Missing | 未见 ZCode 独立发布链路 | Phase 3 重点 |
| 文档 | Windows 安装/升级文档 | Missing | 仅有规划文档 | Phase 3 重点 |
| 测试 | 根级轻量 contract tests | Present | `ZCode/test/*.test.js` | 本轮扩展到 16 条 |
| 测试 | 12 条核心场景回归集 | Missing | 尚未建立 | Phase 2 必须项 |

## Verified This Round

本轮已通过自动化测试验证的最小 contract：

- `BrandConfig` 默认值与环境变量覆盖
- `product.ts` 对品牌 URL 的绑定
- `ProviderAdapter` 标准化模型描述与工具调用
- `openaiCompatible` provider 的标准化能力与配置收敛
- `ModelRegistry` 的索引行为
- `settingsContract` 的优先级顺序与层合并规则

对应测试入口：

- `ZCode/test/brandConfig.test.js`
- `ZCode/test/productConstants.test.js`
- `ZCode/test/providerContract.test.js`
- `ZCode/test/openaiCompatibleProvider.test.js`
- `ZCode/test/modelRegistry.test.js`
- `ZCode/test/settingsContract.test.js`

## Conclusion

当前仓库最大的现实问题不是“核心能力不存在”，而是：

1. 已有能力尚未整理成 ZCode 自己的 contract 与产品边界。
2. Phase 0 缺的基线文档和回归基线未建立。
3. Provider / Brand / Settings 仍停留在局部替换或历史耦合状态。

因此，后续开发应继续沿用当前路线：

- 先完成 Phase 1 的 contract 推广与主链路接入
- 再建立 Phase 2 的 12 条核心场景回归集
- 最后再做 Windows 发布收口
