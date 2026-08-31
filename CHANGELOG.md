# Changelog

## 1.0.0 — 2026-08-31

Harness v1：ZCode 从单轮问答升级为真正的终端 Agent 运行时。

### Highlights

- **Agent 循环**（`ZCode/src/harness/loop.ts`）：provider 无关的多轮 Think→Act→Observe 循环 —— 流式收模型响应、权限门、执行工具、结果回灌，直到模型停止调用工具或护栏触发。
- **核心六件套工具**：Read（cat -n 行号、分页、二进制检测）、Glob（mtime 排序、噪音目录剪枝）、Grep（正则、files/content/count 模式、上下文行）、Write（mkdir -p）、Edit（唯一匹配精确替换、read-before-edit 强制）、Bash（Git Bash `bash -c`、超时、退出码、输出截断）。
- **权限门三模式**：Plan（只读探索，写入被拒并反馈给模型）/ Agent（TTY 下逐调用 y/n，管道输入 fail-closed）/ YOLO（全自动）。
- **护栏**：默认最多 30 轮（`--max-turns` / `ZCODE_MAX_TURNS`）与累计 token 预算（`ZCODE_BUDGET_TOKENS`）；触发即硬停并如实汇报已执行进度。
- **JSONL 会话转录**：默认落 `~/.zcode/projects/<cwd-hash>/<sessionId>.jsonl`，可用 `ZCODE_TRANSCRIPT_DIR` 覆盖。
- **`--json` 信封向后兼容扩展**：新增 `toolCalls[]`（含执行结果与耗时）、`usage`、`stopReason`、`turns`、`sessionId`、`runMode`。
- **双 provider 方言**：同一循环同时驱动 OpenAI 兼容流（DeepSeek）与 Anthropic SSE 流。
- **测试基建**：剧本式假 LLM 服务器（`test/helpers/fakeLlmServer.js`，双方言）驱动真实循环 + 真实工具；live e2e 无 key 自动跳过。

### Acceptance

- UC-03「修复所有失败的测试」在 DeepSeek（`deepseek-v4-flash`）上无人工干预真实通过：Bash → Glob → Read → Bash(观察失败) → Edit×2 → Bash(验证通过) → 如实汇报。证据：[docs/acceptance/](docs/acceptance/)。

### Compatibility notes

- `-p` 现在驱动完整 Agent 循环（此前为单轮问答）；请求体会包含 system 提示与六件套工具定义。
- `--plan` 从占位提示变为真实只读循环。
- Anthropic provider 现在被视为 print-ready（doctor 的 `printReady` 相应变化）。
- 文本模式下最终回答仅流式输出一次（不再在页脚重复打印）。

## 0.1.0 — 2026-06

- 公共 CLI：`help` / `doctor` / `models` / 单轮 `-p` 打印模式（含 `--json`、`--write`、`--reasoning`）。
- 双 provider 流式对话层（OpenAI 兼容 + Anthropic），统一 `tool_call` 流事件契约。
