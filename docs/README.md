# ZCode CLI Agent 文档中心

> 终端原生 AI 编程助手 — 从这里开始上手、开发与查阅 API。

[← 返回项目主页](../README_ZH.md) · [English README](../README.md)

---

## 文档地图

| 我想… | 推荐阅读                                               |
|-------|----------------------------------------------------|
| 5 分钟跑起来 | [快速开始](getting-started/quick-start.md)             |
| 了解功能需求 | [需求分析文档](requirements-analysis.md)                 |
| 查看实现状态 | [实现状态](implementation-status.md)（以 harness 为主线）      |
| 配置开发环境 | [本地开发指南](guides/local-development.md)              |
| Windows 安装 `zcode` | [Windows 安装指南](guides/windows-install.md)          |
| 查环境变量 / CLI 契约 | [API 参考](references/api-reference.md)              |
| 了解整体架构 | [系统设计说明书](系统设计说明书.md)                              |
| 了解 AI 开发方法 | [AI 辅助开发方法论](guides/ai-development-methodology.md) |
| 编写项目 README | [README 提示词模板](仓库readme提示词.md)                     |
| 查看 AI 协作开发记录 | [AI 交互过程记录](ai-interactions/AI交互完成项目报告.md)         |
| 现场演示脚本 | [演示完整流程](guides/demo-walkthrough.md)               |

---

## 目录结构

```
docs/
├── getting-started/               # 入门指南
│   └── quick-start.md             # 5 分钟快速上手
├── guides/                        # 使用与开发指南
│   ├── local-development.md       # 本地环境配置
│   ├── windows-install.md         # Windows 安装包
│   ├── ai-development-methodology.md  # AI 辅助开发方法论
│   └── demo-walkthrough.md        # 现场演示完整流程
├── ai-interactions/               # AI 交互记录
│   ├── overview.md                # 交互总览与总结
│   └── session-*.txt              # 各次会话原始记录
├── references/                    # 技术参考
│   └── api-reference.md           # CLI 契约与环境变量
├── plans/                         # 开发计划（内部）
├── requirements-analysis.md       # 需求分析
├── implementation-status.md       # 代码实现状态
├── 系统设计说明书.md               # 架构与模块设计
└── 仓库readme提示词.md              # README 撰写模板
```

---

## 两种运行模式

理解这一点能避免大部分「跑不起来」的困惑：

| 模式 | 入口 | 适用场景 | 当前状态 |
|------|------|----------|----------|
| **公共 CLI** | `npm start` / `zcode` | 诊断、列模型、脚本化 `-p --json` | ✅ 稳定（公共层全量套件通过） |
| **交互式 TUI** | 裸 `zcode`（TTY） | 流式输出、内联审批、斜杠命令 | ✅ 稳定（`publicCli.js` → `cli/tui.js`） |

两种模式共享同一入口 `publicCli.js`：`-p` 走无头 Agent 循环，裸 `zcode` 在 TTY 上启动交互 TUI。详见 [快速开始 → 两种模式](getting-started/quick-start.md#两种运行模式)。

---

## 源码与测试

| 路径 | 说明 |
|------|------|
| [`ZCode/src/`](../ZCode/src/) | 核心源码 |
| [`ZCode/test/`](../ZCode/test/) | 集成测试 |
| [`ZCode/README.md`](../ZCode/README.md) | 源码目录本地启动说明 |

---

## 内部文档（贡献者向）

以下文档记录开发过程与阻塞分析，普通用户可跳过：

- [T2.2 REPL 启动阻塞分析](ai-interactions/T2.2-repl-startup-hang-analysis.md)
- [T2.2 Require 阻塞说明](ai-interactions/T2.2-require-blocker.md)
- [详细开发计划 v2](plans/zcode-detailed-development-plan-v2.md)

---

*最后更新：2026-06-09*
