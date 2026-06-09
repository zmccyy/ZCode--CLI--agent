# 代码实现文档

> ZCode CLI Agent 实现状态、架构概览与最近变更记录。

[← 返回文档中心](README.md)

---

## 1 架构总览

```
┌─────────────────────────────────────────┐
│  CLI 入口                                │
│  ├── publicCli.js    (Print 模式)        │
│  └── cli.tsx         (REPL TUI 模式)     │
├─────────────────────────────────────────┤
│  查询引擎 (QueryEngine)                   │
│  ├── 对话循环 (REPL loop)                │
│  ├── 流式输出 (streaming)                │
│  └── 上下文压缩 (auto-compact)           │
├─────────────────────────────────────────┤
│  工具系统                                 │
│  ├── FileReadTool / FileEditTool         │
│  ├── FileWriteTool                       │
│  ├── BashTool / GrepTool / GlobTool      │
│  ├── TaskCreate/Update/Get/List/Stop     │
│  ├── LSPTool                             │
│  └── MCP 工具代理                         │
├─────────────────────────────────────────┤
│  Provider 适配层                          │
│  ├── anthropicAdapterClient.ts (直通)     │
│  ├── providerAdapterClient.ts (OpenAI)   │
│  └── 模型注册表 (双线路)                  │
├─────────────────────────────────────────┤
│  权限控制 (PermissionMode)                │
│  ├── ask / code / plan / yolo            │
│  └── 工具级权限规则                       │
└─────────────────────────────────────────┘
```

---

## 2 模块实现状态

### 2.1 CLI 入口层

| 模块 | 文件 | 状态 | 说明 |
|------|------|------|------|
| 公共 CLI | `src/entrypoints/publicCli.js` | ✅ 稳定 | help/doctor/models/print 命令 |
| REPL 入口 | `src/entrypoints/cli.tsx` | 🔧 推进中 | Ink TUI 完整链路 |
| CLI 命令注册 | `src/cli/` | ✅ 稳定 | Commander.js 命令定义 |
| Print 模式 | `src/cli/print.ts` | ✅ 稳定 | `-p --json` 非交互调用 |
| --write/--plan/--yolo/--reasoning | `src/cli/` | ✅ 新增 | CLI 标志与代码块提取 |

### 2.2 Provider 层

| 模块 | 文件 | 状态 | 说明 |
|------|------|------|------|
| Anthropic 直通 | `src/services/api/anthropicAdapterClient.ts` | ✅ 新增 | 跳过 OpenAI 格式转换 |
| Provider 适配 | `src/services/api/providerAdapterClient.ts` | ✅ 修改 | 导出共享工具函数 |
| 客户端工厂 | `src/services/api/client.ts` | ✅ 修改 | 双线路路由 |

### 2.3 工具系统

| 工具 | 文件 | 状态 | 最近变更 |
|------|------|------|----------|
| FileWrite | `src/tools/FileWriteTool/` | ✅ | 增加预览行数至 30 行 |
| FileEdit | `src/tools/FileEditTool/` | ✅ | LSP 诊断通知集成 |
| TaskList | `src/tools/TaskListTool/` | ✅ | 自动恢复上期任务 |
| LSP | `src/tools/LSPTool/` | ✅ | 被动诊断收集 |

### 2.4 UI 组件层

| 组件 | 文件 | 状态 | 最近变更 |
|------|------|------|----------|
| 结构化 Diff | `src/components/StructuredDiff.tsx` | ✅ | Rust NAPI 语法高亮 |
| Diff 列表 | `src/components/StructuredDiffList.tsx` | ✅ | 统计头 + 行号栏 |
| Markdown | `src/components/Markdown.tsx` | 🔧 | 最近修改 |
| Messages | `src/components/Messages.tsx` | 🔧 | 最近修改 |
| StatusLine | `src/components/StatusLine.tsx` | 🔧 | 最近修改 |
| PromptInput | `src/components/PromptInput/PromptInput.tsx` | 🔧 | F1 帮助/Ctrl+K 面板 |
| CodeBlock | `src/components/CodeBlock.tsx` | 🆕 | 新增 |

### 2.5 基础设施层

| 模块 | 文件 | 状态 | 最近变更 |
|------|------|------|----------|
| 键绑定系统 | `src/keybindings/` | ✅ 修改 | F1/Ctrl+K 新增绑定 |
| 设置系统 | `src/utils/settings/types.ts` | ✅ 修改 | lsp.autoDiagnose 开关 |
| 附件系统 | `src/utils/attachments.ts` | ✅ 修改 | autoDiagnose 守卫 |
| 路径补全 | `src/utils/suggestions/directoryCompletion.ts` | ✅ 修改 | Windows 路径支持 |
| 任务持久化 | `src/utils/tasks.ts` | ✅ 修改 | 跨会话自动恢复 |

---

## 3 最近变更摘要（2026-06-08 ~ 2026-06-09）

### 功能增强

| 变更 | 文件数 | 说明 |
|------|--------|------|
| Windows 路径补全 | 1 | `isPathLikeToken` 支持盘符与反斜杠 |
| Diff 展示增强 | 1 | 预览行数 10→30，已有 Rust NAPI 高亮 |
| LSP 诊断自动注入 | 2 | 新增 `lsp.autoDiagnose` 设置，默认开启 |
| 键盘快捷增强 | 3 | F1 帮助面板、Ctrl+K 命令面板 |
| 持久化任务队列 | 2 | 跨会话任务自动恢复 |

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/components/CodeBlock.tsx` | 代码块渲染组件 |

---

## 4 技术栈

| 技术 | 用途 |
|------|------|
| TypeScript | 主要开发语言 |
| React/Ink | 终端 UI 框架 |
| Bun | REPL 运行时与测试 |
| Commander.js | CLI 参数解析 |
| Zod v4 | 运行时 Schema 校验 |
| LRU Cache | 路径补全缓存 |
| Rust (NAPI) | Diff 语法高亮 (ColorDiff) |
| MCP SDK | Model Context Protocol |

---

## 5 构建与测试

```bash
# 安装
bun install

# 测试
bun test              # 801 项，795 通过

# 类型检查
npx tsc --noEmit

# 运行
bun run start --help
bun src/entrypoints/cli.tsx
```

---

*最后更新：2026-06-09*
