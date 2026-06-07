# ZCode 功能增强计划 —— 参考 DeepSeek-TUI

> 制定日期：2026-06-01
> 基于 DeepSeek-TUI (Hmbown/DeepSeek-TUI, Rust, MIT) 的成熟功能对标分析
> 目标：在 ZCode 现有架构基础上，以最小成本引入高价值功能

---

## 1. 对标概览

| 维度 | DeepSeek-TUI | ZCode 现状 | 差距 |
|------|-------------|-----------|------|
| **语言/运行时** | Rust (原生二进制) | TypeScript/JS (Node 22+ / Bun) | 冷启动性能差距 |
| **模型选择** | `--model auto` 自动路由 | 多 Provider 已就绪，无自动路由 | **可填补** |
| **运行模式** | Plan / Agent / YOLO 三级 | Plan Mode + 权限系统已就绪 | **可填补** |
| **成本追踪** | 每轮/会话 Token+费用实时显示 | SSE chunk 含 usage，未渲染 | **可填补** |
| **推理展示** | reasoning_content 流式折叠展示 | OpenAI-compatible provider 未解析 reasoning | **可填补** |
| **@path 上下文** | 输入框 `@file.ts` 快速附加 | FileReadTool 存在，无输入快捷解析 | **可填补** |
| **LSP 诊断** | 编辑后自动注入 LSP errors/warnings | LSPTool 存在，未自动触发 | **可填补** |
| **持久化任务** | SQLite 托底，跨重启存活 | TaskCreate 内存态 | **可填补** |
| **快捷键** | Ctrl+K 命令面板/F1 帮助/Ctrl+R 恢复 | Ink TUI 基础交互 | **可填补** |
| **会话分叉/回滚** | session fork + workspace rollback | 会话管理 136 测试通过，无 fork | 长期 |
| **分发渠道** | npm + Cargo + Homebrew + Docker | 仅 npm | 长期 |

---

## 2. 功能拆解

### 2.1 智能模型自动选择（`--model auto`）

**优先级**: P0 — 直接提升所有用户的使用体验
**预估工时**: 3 天
**依赖**: 无（Provider Runtime + ModelRegistry 已稳定）
**涉及文件**:

| 文件 | 改动 |
|------|------|
| `ZCode/src/providers/runtime.js` | 新增 `resolveAutoModel()` 函数 |
| `ZCode/src/providers/modelRegistry.js` | 新增 `selectByHeuristic()` 方法 |
| `ZCode/src/cli/publicCliCore.js` | `--model auto` 参数解析 |
| `ZCode/test/autoModelSelection.test.js` | 新增测试 |

**规则设计**:

```
输入 prompt 长度 < 500 chars  →  flash / mini 模型（低成本）
输入 prompt 长度 >= 500 chars →  pro / max 模型（高能力）
--model auto --reasoning high  →  强制 reasoning 级别
settings.autoModel.prefer 可覆盖偏好：cost | performance | balanced
```

**DoD**:
1. `zcode --model auto "explain this"` 自动选择 flash 线路模型
2. `zcode --model auto "refactor this entire module..."` 自动选择 pro 线路模型
3. 用户 settings 中可配置 cost/performance 偏好权重
4. `zcode models --auto` 显示当前 auto 模式会选中哪个模型
5. 新增 `test/autoModelSelection.test.js` ≥ 8 条用例通过

**非目标**: 不实现推理级别的动态切换（那是 Phase 4+ 的事）

---

### 2.2 三级运行模式（Plan / Agent / YOLO）

**优先级**: P0 — 直接决定用户信任感和工作效率
**预估工时**: 4 天
**依赖**: 权限系统（98 测试通过）+ Plan Mode（51 测试通过）
**涉及文件**:

| 文件 | 改动 |
|------|------|
| `ZCode/src/utils/permissions/` | 新增 `runMode.js`，三种模式作为权限决策树顶层开关 |
| `ZCode/src/cli/publicCliCore.js` | `--plan` / `--yolo` CLI 参数 |
| `ZCode/src/entrypoints/cli.tsx` | REPL 中模式展示与切换 |
| `ZCode/test/runModes.test.js` | 新增测试 |

**模式定义**:

| 模式 | 标志 | 行为 |
|------|------|------|
| **Plan** | `--plan` | 所有工具只读：禁止 FileEdit/FileWrite/Bash/PowerShell，仅允许 FileRead/Glob/Grep/WebFetch/WebSearch。等同于将所有写工具设为 deny |
| **Agent** | 默认 | 当前行为：根据权限规则交互式审批 |
| **YOLO** | `--yolo` | 自动批准所有工具调用（跳过权限提示），等同于 `permissions.allowAll = true`，但会话级别、可随时降级为 Agent |

**DoD**:
1. `zcode --plan "what does this codebase do?"` 全程不产生任何文件修改
2. `zcode --yolo "fix all lint errors"` 不弹出任何权限确认
3. YOLO 模式下 `Ctrl+C` 可中断并降级为 Agent 模式
4. REPL 状态栏始终显示当前模式（PLAN / AGENT / YOLO）
5. Plan 模式尝试写操作时给出明确提示："当前处于 Plan 模式，此操作已被阻止"
6. 新增 `test/runModes.test.js` ≥ 12 条用例通过

---

### 2.3 实时成本追踪

**优先级**: P0 — 用户使用 LLM 的核心关切
**预估工时**: 2 天
**依赖**: streamChat provider chain（Anthropic + OpenAI-compatible 均已稳定）
**涉及文件**:

| 文件 | 改动 |
|------|------|
| `ZCode/src/providers/anthropic.js` | 从 SSE chunk 中提取 `usage` 累计 |
| `ZCode/src/providers/openaiCompatible.js` | 从 SSE chunk 中提取 `usage` 累计 |
| `ZCode/src/contracts/providerAdapter.js` | 新增 `getSessionUsage()` 到 adapter 接口 |
| `ZCode/src/cli/publicCliCore.js` | `-p --json` 输出附加 `usage` 字段 |
| `ZCode/test/costTracking.test.js` | 新增测试 |

**用法**:
```bash
# 一次性模式：JSON 输出末尾带 usage
zcode -p "explain this" --json
# → { ..., "usage": { "inputTokens": 1234, "outputTokens": 567, "cost": 0.03 } }

# 交互模式：状态栏实时显示
# ── ZCode Agent ── 12.3k in / 5.6k out / $0.15 ──
```

**DoD**:
1. `-p --json` 输出末尾包含 `usage` 字段（inputTokens + outputTokens）
2. Provider adapter 接口定义 `getSessionUsage()` 方法
3. 用户可在 settings 中配置模型价格表 (`settings.pricing`)
4. 新增 `test/costTracking.test.js` ≥ 6 条用例通过

---

### 2.4 推理/思考过程展示（Reasoning Display）

**优先级**: P1 — 使用 DeepSeek 模型时的关键差异化功能
**预估工时**: 2 天
**依赖**: OpenAI-compatible provider 已稳定，需扩展 SSE 解析
**涉及文件**:

| 文件 | 改动 |
|------|------|
| `ZCode/src/providers/openaiCompatible.js` | SSE 解析增加 `delta.reasoning_content` 事件 |
| `ZCode/src/contracts/providerAdapter.js` | chunk 类型新增 `reasoning_delta` |
| ZCode TUI 渲染层 | 折叠块展示 reasoning（`<details>` 风格） |
| `ZCode/test/reasoningDisplay.test.js` | 新增测试 |

**DoD**:
1. 使用 DeepSeek V4 模型时，reasoning_content 以折叠块形式显示
2. `--print` JSON 输出包含 `reasoning` 字段
3. 用户可通过 settings 开关 reasoning 显示（`settings.reasoning.show = false`）
4. 新增 `test/reasoningDisplay.test.js` ≥ 4 条用例通过

---

### 2.5 `@path` 快速上下文附加

**优先级**: P1 — 显著降低用户附加文件上下文的操作成本
**预估工时**: 1.5 天
**依赖**: FileReadTool 已就绪
**涉及文件**:

| 文件 | 改动 |
|------|------|
| `ZCode/src/cli/publicCliCore.js` | 输入预处理：解析 `@path` 语法 |
| ZCode TUI 输入组件 | `@` 触发表路径补全 |
| `ZCode/test/atPathContext.test.js` | 新增测试 |

**用法**:
```
zcode "explain the bug in @src/providers/runtime.js and @src/config/settingsContract.js"
```
自动将两个文件内容注入到 prompt 末尾，作为上下文。

**DoD**:
1. `@"path/to/file.ts"` 自动读取文件内容并附加到 prompt
2. `@src/` 自动附加目录树摘要
3. REPL 输入框中 `@` 触发 Tab 补全
4. 新增 `test/atPathContext.test.js` ≥ 5 条用例通过

---

### 2.6 LSP 诊断自动注入

**优先级**: P2 — 大幅减少"改代码→报错→再改"的循环
**预估工时**: 3 天
**依赖**: LSPTool 已存在，需扩展 FileEditTool 后置钩子
**涉及文件**:

| 文件 | 改动 |
|------|------|
| `ZCode/src/tools/FileEditTool.ts` | 执行后自动触发 LSP 诊断查询 |
| `ZCode/src/tools/LSPTool.ts` | 新增 `getDiagnosticsForFile()` 便捷方法 |
| ZCode TUI 渲染层 | 编辑后内联显示诊断信息 |
| `ZCode/test/lspAutoDiagnostics.test.js` | 新增测试 |

**DoD**:
1. FileEditTool 执行后，自动对已修改文件运行 `getDiagnosticsForFile()`
2. 诊断结果（errors/warnings）注入下一轮对话的 context
3. 用户可通过 settings 关闭（`settings.lsp.autoDiagnose = false`）
4. 新增 `test/lspAutoDiagnostics.test.js` ≥ 6 条用例通过

---

### 2.7 快捷键与命令面板增强

**优先级**: P2 — 提升 TUI 交互效率
**预估工时**: 2 天
**依赖**: Ink TUI 组件体系
**涉及文件**:

| 文件 | 改动 |
|------|------|
| ZCode TUI keyboard handler | 新增快捷键绑定 |
| ZCode TUI components | 新增 CommandPalette 组件 |
| ZCode TUI components | 新增 HelpOverlay 组件 |

**快捷键设计**:

| 按键 | 功能 |
|------|------|
| `Ctrl+K` | 命令面板（搜索所有可用工具/命令） |
| `Ctrl+R` | 恢复历史会话（已有 resume，加快捷入口） |
| `Shift+Tab` | 切换推理级别（off → high → max） |
| `F1` | 可搜索帮助覆盖层 |
| `Tab` | 补全 `/` 命令或 `@` 路径 |

**DoD**:
1. `Ctrl+K` 弹出可搜索命令列表，回车执行
2. `Ctrl+R` 弹出历史会话选择器
3. `F1` 弹出帮助覆盖层，支持搜索
4. `Tab` 在输入框中补全命令/路径

---

### 2.8 持久化任务队列

**优先级**: P2 — 任务跨 REPL 重启存活
**预估工时**: 2 天
**依赖**: 会话管理 JSONL 存储已稳定
**涉及文件**:

| 文件 | 改动 |
|------|------|
| `ZCode/src/tools/TaskCreateTool.ts` | 写入 JSONL 持久化 |
| `ZCode/src/tools/TaskListTool.ts` | 读取 JSONL 恢复任务 |
| `ZCode/src/tools/TaskUpdateTool.ts` | 更新 JSONL 记录 |
| `ZCode/test/persistentTasks.test.js` | 新增测试 |

**DoD**:
1. 创建的 task 写入 `~/.zcode/tasks/<sessionId>.jsonl`
2. 下次 REPL 启动时自动恢复未完成的任务
3. 新增 `test/persistentTasks.test.js` ≥ 4 条用例通过

---

### 2.9 会话分叉与工作区回滚（长期）

**优先级**: P3 — 探索式编程的高级需求
**预估工时**: 5 天
**依赖**: 会话管理 + 文件工具逆操作记录
**涉及文件**:

| 文件 | 改动 |
|------|------|
| `ZCode/src/services/SessionMemory/` | 新增 `forkSession()` |
| `ZCode/src/tools/FileEditTool.ts` | 记录逆向 diff，支持 rollback |
| `ZCode/src/tools/FileWriteTool.ts` | 记录原始内容，支持 rollback |
| `ZCode/test/sessionFork.test.js` | 新增测试 |

**DoD**:
1. `Ctrl+F` 分叉当前会话，在新分支上探索
2. `zcode rollback --session <id>` 回退文件到会话前状态
3. 回滚不依赖 git，仅依赖 ZCode 自身记录
4. 新增 `test/sessionFork.test.js` ≥ 8 条用例通过

---

## 3. 优先级矩阵

| # | 功能 | 优先级 | 工时 | 投入产出比 | 建议排期 |
|---|------|--------|------|-----------|---------|
| 2.1 | 智能模型自动选择 | P0 | 3d | 极高 | Phase 3 W17 |
| 2.2 | 三级运行模式 | P0 | 4d | 极高 | Phase 3 W17-18 |
| 2.3 | 实时成本追踪 | P0 | 2d | 极高 | Phase 3 W16 |
| 2.4 | 推理过程展示 | P1 | 2d | 高 | Phase 3 W18 |
| 2.5 | @path 上下文附加 | P1 | 1.5d | 高 | Phase 3 W18 |
| 2.6 | LSP 诊断自动注入 | P2 | 3d | 中 | Phase 4 W19 |
| 2.7 | 快捷键与命令面板 | P2 | 2d | 中 | Phase 4 W19-20 |
| 2.8 | 持久化任务队列 | P2 | 2d | 中 | Phase 4 W20 |
| 2.9 | 会话分叉与回滚 | P3 | 5d | 低 | Phase 4 W21-22 |

**总计**: 24.5 天，可在 Phase 3 W16 至 Phase 4 W22 内消化。

---

## 4. 回归矩阵（新增场景）

| 编号 | 场景 | 线路 | 覆盖功能 |
|------|------|------|---------|
| S13 | `--model auto` 根据 prompt 长度自动选模型 | 全线路 | 2.1 |
| S14 | `--plan` 模式禁止所有写操作 | 全线路 | 2.2 |
| S15 | `--yolo` 模式跳过所有权限提示 | 全线路 | 2.2 |
| S16 | `-p --json` 输出末尾包含 `usage` 字段 | 全线路 | 2.3 |
| S17 | `@path` 语法触发文件上下文注入 | 全线路 | 2.5 |
| S18 | reasoning_content 在 JSON 输出中保留 | OAI | 2.4 |
| S19 | FileEdit 后自动注入 LSP 诊断 | 全线路 | 2.6 |
| S20 | Task 创建后重启 REPL 仍可恢复 | 全线路 | 2.8 |

---

## 5. 风险与注意事项

1. **Auto 模型选择**：启发式规则可能不适用于所有场景，需提供 settings 覆盖和 `--model explicit` 回退路径
2. **YOLO 模式**：安全敏感，首次运行需显示明确警告并等待用户确认
3. **成本追踪**：模型价格来自用户配置或内置默认值，需标明"估算"字样避免误导
4. **推理展示**：仅 OpenAI-compatible 线路（DeepSeek）有意义，Anthropic 线路需差异化处理 thinking block
5. **LSP 诊断**：依赖用户本地安装了对应 language server，需优雅降级
6. **会话分叉/回滚**：与 git 的关系需要清晰界定——回滚是 ZCode 级别的，不操作 `.git`
