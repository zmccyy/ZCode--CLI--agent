# ZCode UI/输出优化计划 —— 参考 DeepSeek-TUI

> **状态：HISTORICAL（历史文档，仅存档）。** 本计划基于一套后来被放弃的 Ink/TSX
> 交互源码树（query.ts / Messages.tsx / MessageRow.tsx 等，已不存在）。实际交付的
> 交互 TUI 是 `src/cli/tui.js` 的零依赖 readline + ANSI 实现，流式渲染见
> `markdownStream.js`，diff 预览见 `diffPreview.js`。阅读本文时请勿把它当作
> 现状或待办：文中"未实现"的判断均已过时。现状以 `docs/harness/roadmap.md` 为准。
>
> 制定日期：2026-06-07
> 目标：优化终端交互界面的视觉结构和文件创建/修改流程，对标 DeepSeek-TUI 的 UX 体验

---

## 1. 现状分析

### 1.1 当前渲染管线

```
streamChat (Anthropic/OAI) → content blocks → query.ts/ask()
  ├── [Print 模式] → StructuredIO → stdout (JSON/NDJSON/text)
  └── [交互模式] → setMessages() → normalize/filter/group
       └── Messages.tsx → MessageRow.tsx → Message.tsx
            ├── AssistantTextMessage → Markdown 渲染
            ├── AssistantToolUseMessage → tool_use 卡片 + renderToolUseMessage()
            ├── UserToolResultMessage → tool_result 卡片 + renderToolResultMessage()
            └── GroupedToolUseContent → 并行工具调用折叠
              ↓
       Ink reconciler → ANSI terminal output
```

### 1.2 核心差距

| 方面 | 当前 ZCode | DeepSeek-TUI | 差距 |
|------|-----------|-------------|------|
| **布局结构** | 扁平消息流，无明确视觉分区 | 思考块 → 工具调用 → 结果 → 回复，清晰分层 | 需结构化分区 |
| **文件编辑展示** | inline diff，终端全宽渲染 | 语法高亮 diff，行号，接受/拒绝操作 | diff 可读性不足 |
| **文件创建展示** | 前 10 行预览 + "Wrote N lines" | 全量语法高亮，带文件路径头部 | 预览太少 |
| **代码块操作** | 纯展示，无交互 | 每个代码块有 "Apply to file" 操作 | 缺少快捷写文件入口 |
| **思考过程** | 默认隐藏，verbose 才显示 | 折叠块，可展开/收起 | 缺少折叠交互 |
| **状态栏** | 简要 idle 状态 | 实时 token 用量 + 费用 + 模式 | 信息密度低 |
| **输入区域** | 基础 PromptInput | @path 补全 + Tab 命令补全 + 模式切换 | 缺少上下文快速附加 |

### 1.3 关键源文件

| 文件 | 职责 |
|------|------|
| `ZCode/src/screens/REPL.tsx` | 主交互屏幕布局 |
| `ZCode/src/components/Messages.tsx` | 消息列表渲染 |
| `ZCode/src/components/Message.tsx` | 消息类型路由 |
| `ZCode/src/components/messages/AssistantTextMessage.tsx` | 助手文本（Markdown 渲染） |
| `ZCode/src/components/messages/AssistantToolUseMessage.tsx` | 工具调用卡片 |
| `ZCode/src/components/messages/UserToolResultMessage/` | 工具结果渲染 |
| `ZCode/src/tools/FileEditTool/UI.tsx` | 文件编辑 UI |
| `ZCode/src/tools/FileWriteTool/UI.tsx` | 文件创建/写入 UI |
| `ZCode/src/components/Markdown.tsx` | Markdown → Ink 渲染 |
| `ZCode/src/ink/` | 自定义 Ink 渲染引擎 |

---

## 2. 优化任务拆解

### 2.1 消息流结构化分层

**优先级**: P0
**预估工时**: 3 天
**依赖**: 无

**目标**: 将当前扁平的消息流改为 DeepSeek-TUI 风格的结构化分层显示：

```
┌──────────────────────────────────────────────┐
│  🤔 Thinking (click to expand)               │ ← 折叠的思考块
├──────────────────────────────────────────────┤
│  📖 Read src/providers/runtime.js            │ ← 工具调用卡片
│  ✓ 125 lines read                            │ ← 工具结果
├──────────────────────────────────────────────┤
│  💬 Assistant                                │ ← 助手文本回复
│  The issue is in the resolveProvider func...  │
│                                              │
│  ```js                                       │ ← 代码块 + 操作按钮
│  function fix() { ... }                      │
│  ```                          [Apply to file]│
├──────────────────────────────────────────────┤
│  ✏️ Update src/providers/runtime.js          │ ← 文件编辑工具
│  ┌ diff ─────────────────────────────────┐   │
│  │ - old line                            │   │
│  │ + new line                            │   │
│  └───────────────────────────────────────┘   │
│  ✓ Updated successfully                      │
└──────────────────────────────────────────────┘
```

**改动点**:

| 文件 | 改动 |
|------|------|
| `Messages.tsx` | 新增 `MessageGroup` 分组逻辑：将连续的 thinking→tool_use→tool_result→text 归为一个交互轮次，用分隔线隔开 |
| `Message.tsx` | 在 `assistant` 类型消息前后添加轮次分隔组件 |
| 新增 `TurnSeparator.tsx` | 渲染 `──── Turn N · 1.2k tokens ────` 风格的分隔线 |

**DoD**:
1. 每个"用户输入→助手回复"轮次之间有明确的分隔线
2. 分隔线显示轮次编号和该轮 token 用量
3. thinking 块、工具调用、助手文本在视觉上有清晰分区
4. 不影响现有 verbose/transcript 模式的行为

---

### 2.2 代码块"应用到文件"操作

**优先级**: P0
**预估工时**: 2 天
**依赖**: FileWriteTool 已稳定

**目标**: 助手回复中的 Markdown 代码块，每块增加"Apply to file"交互操作，用户可以直接将代码块内容写入文件，无需等待 LLM 调用 FileWriteTool。

**交互流程**:
1. 助手回复中包含 ` ```js ` 代码块
2. 代码块下方显示: `[Ctrl+O → Apply to file]` 提示
3. 用户按 `Ctrl+O` 后弹出文件路径输入/确认
4. 确认后直接调用 FileWriteTool 写入

**改动点**:

| 文件 | 改动 |
|------|------|
| `Markdown.tsx` | 每个 code fence 块下方渲染操作提示行 |
| `AssistantTextMessage.tsx` | 新增 `onApplyCodeToFile` 回调 props |
| `REPL.tsx` | 连接 `Ctrl+O` 快捷键 → 当前聚焦代码块 → FileWriteTool |
| 新增 `CodeBlockActions.tsx` | 代码块底部操作栏：`[Apply to file] [Copy]` |

**DoD**:
1. 每个 Markdown 代码块下方显示 `[Apply to file]` 操作入口
2. 用户触发后弹出文件路径确认提示
3. 确认后文件立即写入磁盘
4. 写入成功后代码块旁显示 `✓ Written to src/foo.ts`
5. 如果文件已存在，显示 diff 预览并请求覆盖确认

---

### 2.3 文件编辑/创建 Diff 展示增强

**优先级**: P0
**预估工时**: 2 天
**依赖**: `diff` 库已引入，`FileEditToolUpdatedMessage` 已有基础 diff 渲染

**目标**: 让 diff 展示更接近 IDE 的代码审查体验，语法高亮 + 行号 + 变更类型标记。

**改进前**（当前）:
```
- old line
+ new line
```

**改进后**:
```
── ✏️ Update src/providers/runtime.js ──────────
 45 │ - export function resolveProvider(config) {
    │ + export async function resolveProvider(config, opts) {
 46 │   const mode = detectMode(config)
    │ +   const fallback = opts?.fallback ?? 'anthropic'
 47 │   return createProvider(mode)
    │ +   return createProvider(mode, { fallback })
─────────────────────────────────────────────────
 ✓ 3 lines changed  │  ✓ Applied
```

**改动点**:

| 文件 | 改动 |
|------|------|
| `FileEditToolUpdatedMessage.tsx` | 增加行号列、语法高亮、变更类型颜色标记（红-/绿+/蓝~） |
| `FileEditTool/UI.tsx` | `renderToolResultMessage` 增加 `<DiffHeader>` 带文件路径 + 变更统计 |
| `FileWriteTool/UI.tsx` | `renderToolResultMessage` 中 `create` 路径展示更多行（当前 MAX_LINES_TO_RENDER=10 → 30），增加语法高亮 |
| 新增 `SyntaxHighlightedDiff.tsx` | 统一的 diff 渲染组件，支持行号、高亮、折叠超出部分 |

**DoD**:
1. diff 中删除行显示红色 `-` 前缀，新增行显示绿色 `+` 前缀
2. diff 左侧带行号列
3. 文件头显示变更统计（N lines changed / M lines added / K lines deleted）
4. 新创建文件默认展示前 30 行（vs 当前 10 行）
5. 超长 diff 自动折叠，Ctrl+O 展开全文

---

### 2.4 思考过程折叠展示

**优先级**: P1
**预估工时**: 1.5 天
**依赖**: OpenAI-compatible provider 需先支持 `reasoning_content` 解析（见 deepseek-tui-inspired-improvements.md 2.4）

**目标**: 模型的思考/推理过程默认折叠，显示一行摘要，用户按 `Enter` 或点击展开。

```
▶ 🤔 Thinking · 234 tokens · click to expand

  [展开后]:
▼ 🤔 Thinking · 234 tokens
  ┌──────────────────────────────────────────────┐
  │ Let me analyze the user's request...         │
  │ First, I need to understand the codebase... │
  │ The key function is in runtime.js...         │
  └──────────────────────────────────────────────┘
```

**改动点**:

| 文件 | 改动 |
|------|------|
| `AssistantThinkingMessage.tsx` | 用 `useState` 实现折叠/展开，默认折叠，显示 token 数和摘要 |
| `Message.tsx` | 将 thinking 块渲染位置调整到 assistant text 之前（而非隐藏） |
| `REPL.tsx` | Enter 键在 thinking 块聚焦时触发展开/折叠 |

**DoD**:
1. 非 verbose 模式下，thinking 块默认折叠为一行
2. 折叠行显示 token 数和首句摘要
3. Enter 或点击展开/折叠
4. verbose/transcript 模式下保持全部展开（现有行为不变）

---

### 2.5 状态栏信息增强

**优先级**: P1
**预估工时**: 1 天
**依赖**: 成本追踪（见 deepseek-tui-inspired-improvements.md 2.3）

**目标**: 底部状态栏从当前的简要信息升级为更丰富的信息面板。

**改进前**:
```
> _
```

**改进后**:
```
── ZCode · AGENT · claude-sonnet-4-6 · 12.3k/5.6k · $0.15 ──
> _
```

**改动点**:

| 文件 | 改动 |
|------|------|
| `REPL.tsx` footer 区域 | 新增 `<StatusBar>` 组件，显示模式/模型/token/费用 |
| 新增 `StatusBar.tsx` | 统一状态栏组件 |
| `BriefIdleStatus.tsx` | 整合进 StatusBar |

**DoD**:
1. 状态栏常驻显示：运行模式（PLAN/AGENT/YOLO）、当前模型、累计 token、费用
2. 模式切换时实时更新
3. 费用数据来自 cost tracking 模块

---

### 2.6 输入区域增强（@path 补全 + 命令面板入口）

**优先级**: P1
**预估工时**: 2 天
**依赖**: `PromptInput.tsx` 组件

**目标**: 输入区域支持 `@` 路径补全和 `/` 命令补全，与 DeepSeek-TUI 的 Tab 补全对齐。

```
> fix the bug in @src/providers/run[TAB]
                    ┌─────────────────────────┐
                    │ src/providers/runtime.js │
                    │ src/providers/runtime.test.js │
                    └─────────────────────────┘
```

**改动点**:

| 文件 | 改动 |
|------|------|
| `PromptInput.tsx` | 新增 `@` 触发文件路径补全、`/` 触发命令补全 |
| 新增 `InputCompletion.tsx` | 补全弹窗组件 |
| `publicCliCore.js` | `@path` 语法解析（已在 deepseek-tui plan 2.5 中规划） |

**DoD**:
1. 输入 `@` 后 Tab 触发文件路径补全
2. 输入 `/` 后 Tab 触发命令补全（/help, /clear, /doctor 等）
3. 补全列表支持方向键选择 + Enter 确认
4. `@path` 在提交时自动调用 FileRead 附加上下文

---

## 3. 实施顺序

| 阶段 | 任务 | 工时 | 依赖 |
|------|------|------|------|
| **Week 1** | 2.1 消息流结构化分层 | 3d | 无 |
| | 2.2 代码块"应用到文件" | 2d | 无 |
| **Week 2** | 2.3 Diff 展示增强 | 2d | 无 |
| | 2.4 思考过程折叠 | 1.5d | reasoning_content 解析完成 |
| | 2.5 状态栏增强 | 1d | 成本追踪完成 |
| **Week 3** | 2.6 输入区域增强 | 2d | 无 |

**总计**: 11.5 天，与 deepseek-tui-inspired-improvements.md 中的功能并行推进。

---

## 4. 回归场景

| 编号 | 场景 | 覆盖 |
|------|------|------|
| S21 | 消息流中连续两轮对话有明确分隔线 | 2.1 |
| S22 | 代码块 `[Apply to file]` 触发写文件流程 | 2.2 |
| S23 | Apply to file → 文件已存在 → diff 预览 + 覆盖确认 | 2.2 |
| S24 | Diff 展示带行号 + 语法高亮 + 变更统计 | 2.3 |
| S25 | Thinking 块默认折叠，Enter 展开 | 2.4 |
| S26 | 状态栏显示模式/模型/token/费用 | 2.5 |
| S27 | `@` Tab 补全文件路径 | 2.6 |
| S28 | verbose 模式下 thinking 保持全部展开 | 2.4 |

---

## 5. 风险

1. **Ink 渲染性能**: 结构化分层增加更多 Box/Text 节点，可能影响长会话渲染性能。需在 `Messages.tsx` 的 `renderableMessages` 阶段做虚拟化裁剪
2. **代码块"应用到文件"的定位**: 终端环境下如何让用户"选择"一个特定代码块需要设计——初步方案是每个代码块前加序号标记 `[1]` `[2]`，用户输入 `:apply 2 path/to/file.ts`
3. **diff 行号**: 当前 `FileEditToolUpdatedMessage` 基于 `StructuredPatchHunk`，行号信息已在 `adjustHunkLineNumbers` 中处理，直接可用
4. **与现有 verbose/transcript 模式的兼容**: 结构化分层在 verbose 下可简化（少用折叠），在 transcript 下保持当前行为
5. **Windows 终端兼容**: ANSI 颜色/Unicode 字符需在 Windows Terminal / cmd / PowerShell 中测试，避免使用仅 macOS 支持的符号
