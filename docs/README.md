# ZCode CLI Agent 文档中心

> 终端原生 AI 编程助手 — 从这里开始上手、开发与查阅 API。

[← 返回项目主页](../README_ZH.md) · [English README](../README.md)

---

## 文档地图

| 我想… | 推荐阅读 |
|-------|----------|
| 5 分钟跑起来 | [快速开始](getting-started/quick-start.md) |
| 配置开发环境 | [本地开发指南](guides/local-development.md) |
| 查环境变量 / CLI 契约 | [API 参考](references/api-reference.md) |
| 了解整体架构 | [系统设计说明书](系统设计说明书.md) |
| 编写项目 README | [README 提示词模板](仓库readme提示词.md) |

---

## 目录结构

```
docs/
├── getting-started/          # 入门指南
│   └── quick-start.md        # 5 分钟快速上手
├── guides/                   # 使用与开发指南
│   └── local-development.md  # 本地环境配置
├── references/               # 技术参考
│   └── api-reference.md      # CLI 契约与环境变量
├── plans/                    # 开发计划（内部）
├── 系统设计说明书.md          # 架构与模块设计
└── 仓库readme提示词.md        # README 撰写模板
```

---

## 两种运行模式

理解这一点能避免大部分「跑不起来」的困惑：

| 模式 | 入口 | 适用场景 | 当前状态 |
|------|------|----------|----------|
| **公共 CLI** | `npm start` / `bun run start` / `zcode` | 诊断、列模型、脚本化 `-p --json` | ✅ 稳定可用 |
| **完整 REPL** | `bun src/entrypoints/cli.tsx` | 交互式 TUI、MCP、工具循环 | 🔧 开发中 |

公共 CLI 不会启动完整 Ink TUI，这是刻意设计 — 只依赖已裁剪的稳定模块。详见 [快速开始 → 两种模式](getting-started/quick-start.md#两种运行模式)。

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

- [T2.2 REPL 启动阻塞分析](T2.2-repl-startup-hang-analysis.md)
- [T2.2 Require 阻塞说明](T2.2-require-blocker.md)
- [详细开发计划 v2](plans/zcode-detailed-development-plan-v2.md)

---

*最后更新：2026-05-31*
