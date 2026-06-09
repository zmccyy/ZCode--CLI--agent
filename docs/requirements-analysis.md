# 需求分析文档

> ZCode CLI Agent 软件需求规格 — 面向开发者、架构师与项目评审。

[← 返回文档中心](README.md)

---

## 1 项目背景

AI 编程助手大多绑定浏览器（ChatGPT）或 IDE（Copilot/GitHub Copilot）。对于偏好终端的开发者，缺乏一个**终端原生的 AI 编程 Agent**——能在 Shell 中读代码、跑命令、搜文件、调外部工具、交改动，全程不离开命令行。

ZCode CLI Agent 填补这一空白。对标 Claude Code 的终端 Agent 能力，面向需要 **可脚本化、本地优先、多模型可切换** AI 工作流的开发者。

---

## 2 核心需求

### 2.1 功能需求

| 编号 | 需求 | 描述 | 优先级 |
|------|------|------|--------|
| FR-01 | 自然语言交互 | 用户在终端输入自然语言指令，系统理解意图并执行 | P0 |
| FR-02 | 多 Provider 支持 | 支持 Anthropic、AWS Bedrock、Google Vertex、Azure、OpenAI 兼容 | P0 |
| FR-03 | 文件读写工具 | Agent 可读取、创建、编辑本地文件 | P0 |
| FR-04 | Shell 命令执行 | Agent 可在用户批准后执行 Shell 命令 | P0 |
| FR-05 | 代码搜索 | 支持 glob 模式匹配和 ripgrep 正则搜索 | P1 |
| FR-06 | MCP 协议集成 | 通过 Model Context Protocol 接入外部工具服务器 | P1 |
| FR-07 | LSP 诊断集成 | 代码编辑后自动注入语言服务器诊断信息 | P1 |
| FR-08 | 权限精细管控 | 工具执行按模式（ask/code/plan/yolo）分级审批 | P0 |
| FR-09 | 脚本化 Print 模式 | `-p --json` 非交互式调用，输出结构化 JSON | P1 |
| FR-10 | 交互式 TUI | 全屏 Ink 终端界面，含状态栏、会话管理、多模态输入 | P1 |
| FR-11 | 会话持久化 | 对话转录 JSONL 存储，支持历史搜索与恢复 | P1 |
| FR-12 | 任务管理系统 | 创建/更新/列表/停止任务，支持依赖关系 | P1 |
| FR-13 | 路径自动补全 | 输入 `@` 触发文件/目录路径补全，含 Windows 路径支持 | P2 |
| FR-14 | 命令面板 | 快捷键驱动的命令搜索与执行 | P2 |
| FR-15 | 键盘快捷系统 | 可配置的键绑定，支持 chord 序列 | P2 |

### 2.2 非功能需求

| 编号 | 需求 | 描述 | 指标 |
|------|------|------|------|
| NFR-01 | 运行时兼容 | Windows 10/11 优先，macOS/Linux 兼容 | Node ≥22, Bun ≥1.0 |
| NFR-02 | 启动性能 | 公共 CLI 启动时间 | < 500ms |
| NFR-03 | 代码质量 | 测试覆盖率 | ≥ 80% |
| NFR-04 | 安全性 | API Key 不可序列化到会话日志 | 0 泄露 |
| NFR-05 | 可扩展性 | 新工具/新 Provider 可插拔注册 | 插件化接口 |

---

## 3 用户角色

| 角色 | 描述 | 核心场景 |
|------|------|----------|
| 开发者 | 日常使用终端编程的开发者 | 交互式 TUI，代码生成，Bug 修复 |
| CI/自动化用户 | 使用 Print 模式的脚本用户 | `-p --json` 非交互调用 |
| 插件开发者 | 扩展 MCP 工具的第三方开发者 | MCP 协议集成 |

---

## 4 用例场景

### UC-01：代码生成与文件写入

```
用户: "Create a Python script that calculates Fibonacci numbers"
  → Agent 调用 FileWrite 工具
    → 创建 fib.py 并写入完整实现
  → Agent 报告文件路径和代码行数
```

### UC-02：代码搜索与分析

```
用户: "Find all places where authentication logic is implemented"
  → Agent 调用 Grep 工具搜索 auth 关键字
  → Agent 调用 Read 工具阅读匹配文件
  → Agent 返回结构化分析
```

### UC-03：Shell 任务自动化

```
用户: "Run all tests and fix any failures"
  → Agent 调用 Bash: bun test
  → Agent 解析测试输出，定位失败用例
  → Agent 修改源码 → 再测试 → 循环直到通过
```

### UC-04：Plan 模式安全预览

```
用户: --plan "Delete all .log files"
  → Agent 搜索 .log 文件
  → Agent 列出将删除的文件清单
  → Agent 提示 "Remove --plan to execute"
  → 不执行任何修改操作
```

---

## 5 需求优先级与里程碑

| 阶段 | 范围 | 状态 |
|------|------|------|
| Phase 0 | 项目脚手架、公共 CLI、基础 Provider | ✅ 完成 |
| Phase 1 | Anthropic 第一方 API 直通、REPL 启动链路 | ✅ 完成 |
| Phase 2 | 交互式 TUI、工具系统、权限控制 | 🔧 推进中 |
| Phase 3 | MCP 集成、Session 管理、上下文压缩 | 🔧 推进中 |
| Phase 4 | 测试覆盖、CI/CD、发布准备 | 📋 计划中 |

---

## 6 约束与假设

- **平台约束**：主开发与测试在 Windows 11 环境完成，兼容性验证在 macOS/Linux
- **网络约束**：LLM 调用依赖外部 API 网络连通性
- **API Key 假设**：用户自行管理 LLM Provider 的 API Key
- **终端假设**：TUI 模式依赖支持 ANSI escape code 的终端（推荐 Windows Terminal）

---

*最后更新：2026-06-09*
