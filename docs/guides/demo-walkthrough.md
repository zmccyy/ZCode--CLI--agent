# ZCode 现场演示完整流程

> 面向课程答辩 / 项目展示的完整演示脚本，涵盖从环境准备到交互式 REPL 的全流程。

---

## 环境要求

| 依赖 | 版本 | 检查命令 |
|------|------|----------|
| Node.js | >= 22 | `node -v` |
| Bun | >= 1.0 (REPL 需要) | `bun --version` |
| Git Bash | Windows 下必需 | — |
| API Key | DeepSeek 或其他兼容 Provider | 配置在 `.env` |

---

## 第一步：打开终端，进入项目目录

打开 **Windows Terminal**（或 Git Bash），执行：

```bash
cd "E:\项目\ZCode--CLI--agent"
```

确认环境：

```bash
node -v        # 应显示 v24.x
bun --version  # 应显示 1.3.x
```

**讲解词：**
> "ZCode 是一个 Windows-first 的 AI 编程 CLI Agent，支持 Node.js 和 Bun 双运行时。当前环境已就绪。"

---

## 第二步：离线模式演示（约 2 分钟，全自动）

```bash
bash scripts/demo-all-features.sh
```

脚本自动执行 6 个 Part，**无需 API Key**，全程无需手动操作。

### 演示亮点（按屏幕输出顺序）

| Part | 内容 | 演示价值 |
|------|------|----------|
| **1.1** | 版本信息 — `zcode --version` / `-v` | 证明 CLI 入口可正常运行 |
| **1.2** | 帮助系统 — 6 项检查 | `--write`, `--plan`, `--reasoning` 等新增功能均在帮助中可查 |
| **1.3** | 环境诊断 — `doctor` 文本 + JSON 双模式 | 展示 provider 状态、12 个可用模型、runtime 信息 |
| **1.4** | 模型列表 — `models` 文本 + JSON | DeepSeek + Claude 全系列 12 个模型，双线路 registry |
| **1.5** | Plan 模式 — `--plan -p "prompt"` | 展示只读分析模式，提示"Remove --plan to execute" |
| **1.6** | YOLO 模式 — 选项解析 | `--yolo` 自动批准模式已适配 |

Part 2 实时演示在此模式**被自动跳过**（黄色 ⚠ 提示），Part 3 REPL 也跳过。

### 预期输出

```
Results: 21 passed  0 failed  9 skipped
演示完成！
```

**讲解词：**
> "21 项全部通过，0 失败。9 项跳过是因为还没加 `--live` 标志。接下来我们接入 API，展示真实的 LLM 调用。"

---

## 第三步：实时模式演示（约 5 分钟，8 项 API 调用）

### 前置条件：确认 .env 配置

```bash
cat .env
```

应包含（示例）：

```
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-v4-flash
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com
ZCODE_OPENAI_API_KEY=sk-xxx
```

### 运行实时演示

```bash
bash scripts/demo-all-features.sh --live
```

Part 2 将**真实调用 LLM**，依次展示：

| 序号 | 命令 | 演示要点 |
|------|------|----------|
| **2.1** | `-p "Say hello in exactly 3 words"` | 基础文本生成，验证连通性 |
| **2.2** | `-p "What is 1+1?" --json` | JSON 结构化输出，包含 `inputTokens`/`outputTokens` 统计 |
| **2.3** | `-p "Explain var vs let" --reasoning` | 推理过程展示 — 先输出 `[Reasoning]` 思考过程，再输出答案 |
| **2.4** | `-p "Write Fibonacci script" --write fib.py` | 代码写入指定路径，用 `head` 验证内容 |
| **2.5** | `-p "Create index.html" --write` | **多文件自动写入** — 识别代码块语言，生成独立 .html/.css/.js |
| **2.6** | `-p "Say good morning" -m deepseek-chat` | 指定模型切换 |
| **2.7** | `-p "Write system info bash script" --write` | 综合演示：生成可执行的完整脚本 |

每项结束后显示 `✓ Completed`。

**讲解词：**
> "注意到 2.5 的多文件写入：ZCode 从回复中自动提取了 3 个代码块，根据语言标识分别写入了 .html、.css、.js 三个文件。2.3 展示了推理过程 — 模型先思考再输出，这对复杂问题很有价值。"

---

## 第四步：交互式 REPL 演示（约 8-10 分钟，核心环节）

### 4.0 过渡

**讲解词：**
> "以上都是命令行单次调用。ZCode 的核心体验是交互式 REPL——一个完整的 AI 编程 Agent，可以读代码、写文件、执行命令，还能在一次会话中保持上下文。我现在演示一下。"

### 4.1 启动 REPL

```bash
cd ZCode && bun src/entrypoints/cli.tsx
```

**启动后观察：**
- 全屏 TUI 界面
- 顶部状态栏：当前模型名称、session ID、token 消耗
- 底部输入区支持多行输入
- React/Ink 渲染，终端原生体验

### 4.2 场景一：工具能力概览

**输入：**
```
Hello, what tools do you have access to? List them briefly.
```

**演示要点：** ZCode 流式输出回复，逐字渲染。展示工具列表：文件读写、Shell 执行、Web 搜索、Git 操作、LSP 诊断等。

### 4.3 场景二：读取并分析代码

**输入：**
```
Read ZCode/src/utils/codeBlockExtractor.js and explain its architecture in 3 bullet points
```

**演示要点：** ZCode 调用 Read 工具读取文件，分析后返回结构化解读。展示 Agent 的代码理解能力。

### 4.4 场景三：创建新文件（课程亮点）

**输入：**
```
Create a new file ZCode/tmp/demo/hello.py — a Python script that prints the first 20 Fibonacci numbers with execution time measurement
```

**演示要点：** ZCode 调用 FileWrite 工具创建文件。创建后，切回另一个终端验证：

```bash
python ZCode/tmp/demo/hello.py
```

**讲解词：**
> "ZCode 不仅写了文件，还选了正确的语言和完整的实现。我们现在在另一个终端执行它，验证结果正确。"

### 4.5 场景四：Shell 命令执行

**输入：**
```
List all TypeScript files in ZCode/src that contain TODO comments, grouped by which directory they're in
```

**演示要点：** ZCode 调用 Bash 工具执行 `grep` + `sort`。展示 Agent 可以操作系统、执行任意命令（需用户批准）。

### 4.6 场景五：多轮上下文保持

**紧接着上一轮结果，输入：**
```
For each TODO you found, classify whether it's likely a Claude Code fork artifact or ZCode's own work
```

**演示要点：** ZCode 记住上一轮的 grep 输出，基于上下文进行分析和分类。展示会话级记忆能力。

### 4.7 场景六：Plan Mode（安全控制）

按 `Ctrl+C` 或输入 `/exit` 退出 REPL，重新以 Plan 模式启动：

```bash
cd ZCode && bun src/entrypoints/cli.tsx --plan
```

**输入任意文件操作请求：**
```
Delete all .log files in the project
```

**演示要点：** Plan 模式下 ZCode **只分析不执行**，输出操作计划和影响范围，但不会真正删除文件。

**讲解词：**
> "Plan 模式是一个安全沙箱。当你对操作不确定时，先用 Plan 模式看它打算做什么，确认后再去掉 --plan 执行。"

---

## 第五步：收尾与验证（约 1 分钟）

### 5.1 验证文件持久化

退出 REPL，回到 shell：

```bash
ls ZCode/tmp/demo/           # 刚才创建的 hello.py 还在
ls .claude/projects/*/       # 会话记录 JSONL 持久化保存
```

### 5.2 展示功能对照表

```bash
bash scripts/demo-all-features.sh
```

滚动到 Part 5 功能对照表，26 项功能一目了然。

**讲解词：**
> "总结一下：ZCode 支持 5 种 LLM Provider、26+ 项功能、多语言代码写入、MCP 协议扩展、完整的权限控制系统。所有会话持久化保存，可以回溯和恢复。"

### 5.3 清理演示文件

```bash
rm -rf tmp/demo-*
```

---

## 时间分配总结

| 阶段 | 时长 | 方式 | 谁在说 |
|------|------|------|--------|
| 环境确认 | 30 秒 | 手动 | 配合讲 |
| 离线脚本 (Part 1-6) | 2 分钟 | **自动** | 看屏幕即可 |
| 实时脚本 (Part 2 --live) | 4-5 分钟 | **自动** | 关键项补充说明 |
| 过渡到 REPL | 20 秒 | 手动 | 承上启下 |
| REPL 6 个场景 | 8-10 分钟 | 手动 | **主讲解段** |
| 收尾验证 | 1 分钟 | 手动 | 总结 |
| **总计** | **16-19 分钟** | | |

---

## 排练检查清单

- [ ] `.env` 中 API Key 未过期，model 可用
- [ ] `node -v` ≥ 22，`bun --version` ≥ 1.0
- [ ] 终端窗口支持 ANSI 颜色（Windows Terminal 推荐）
- [ ] 网络通畅，可访问 DeepSeek API
- [ ] `tmp/` 目录不存在（避免旧文件干扰 `--write` 演示）
- [ ] REPL 场景二的 `codeBlockExtractor.js` 文件存在
- [ ] 提前安装 Python 或准备替代验证方式（场景三 `python hello.py`）

---

## 常见问题处理

**Q: `--live` 脚本报 API 错误？**
A: 检查 `.env` 中的 `ZCODE_OPENAI_API_KEY` 是否有效，`ZCODE_OPENAI_BASE_URL` 是否正确。

**Q: Bun REPL 启动失败？**
A: 检查是否在 `ZCode/` 子目录中执行，`bun src/entrypoints/cli.tsx` 相对路径需从 `ZCode/` 目录起。

**Q: 终端中文乱码？**
A: 使用 Windows Terminal（非 CMD），设置字体为支持中文等宽字体（如 Sarasa Term SC, Microsoft YaHei Mono）。

**Q: 演示过程中网络中断？**
A: 离线脚本 21 项纯本地检查不受影响。实时部分重新跑 `--live` 即可。
