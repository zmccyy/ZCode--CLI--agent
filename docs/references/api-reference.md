# API 参考

> 公共 CLI 命令契约、JSON 输出格式与环境变量完整说明。

[← 文档中心](../README.md) · [快速开始](../getting-started/quick-start.md)

---

## 公共 CLI 概览

入口：`ZCode/src/entrypoints/publicCli.js`  
全局命令名：`zcode`（`npm link` 后）

```
zcode [command] [options]
zcode -p, --print <prompt> [options]
```

### 命令

| 命令 | 说明 |
|------|------|
| `help` | 显示帮助（默认行为） |
| `doctor` | 检查运行时、Provider 与模型注册 |
| `models` | 列出当前 Provider 暴露的模型 |
| `sessions` | 列出本工作区最近的会话转录 |
| `-p, --print <prompt>` | 非交互式 Agent 循环：探索、修改、验证、汇报 |

### 全局选项

| 选项 | 说明 |
|------|------|
| `-h, --help` | 显示帮助 |
| `-v, --version` | 显示版本 |
| `--json` | JSON 格式输出（适用于 `doctor`、`models`、`-p`） |
| `-m, --model <id>` | 指定模型 ID（配合 `-p`） |

### 示例

```bash
zcode --help
zcode doctor --json
zcode models --json
zcode -p "Summarize this repo" --json
zcode -p "Hello" -m deepseek-chat --json
```

---

## JSON 输出格式

### Print 模式 (`-p --json`)

```json
{
  "provider": "openai-compatible:deepseek",
  "model": "deepseek-chat",
  "messageId": null,
  "text": "模型回复的完整文本",
  "toolCalls": [
    { "id": "call_1", "name": "Read", "input": {}, "result": "…", "isError": false, "durationMs": 12 }
  ],
  "finishReason": "stop",
  "stopReason": "end_turn",
  "turns": 3,
  "compactions": 0,
  "usage": { "inputTokens": 0, "outputTokens": 0, "totalTokens": 0 },
  "runMode": "agent",
  "resumedFrom": null
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | string | Provider 标识 |
| `model` | string | 实际使用的模型 |
| `messageId` | null | 当前恒为 null（非 provider 响应 ID，使用方不得依赖） |
| `text` | string | 模型文本回复 |
| `toolCalls` | array | 全部执行过的工具调用（含失败与被拒） |
| `finishReason` | string | Provider 侧结束原因：`stop` · `tool_call` · `error` |
| `stopReason` | string | 循环停止原因：`end_turn` · `max_turns` · `budget_exceeded` · `aborted` · `error` |
| `turns` | number | 循环轮数 |
| `compactions` | number | 自动上下文压缩次数 |
| `usage` | object | 累计 token（含压缩请求） |
| `runMode` | string | `plan` · `agent` · `yolo` |
| `resumedFrom` | string \| null | `--continue`/`--resume` 时的来源会话 |
| `warnings` | array（可选） | 非致命问题（如 transcript 写失败）；仅存在时出现 |

非 JSON 模式下，`-p` 输出进度行 + 最终文本 + usage 概要。

### Doctor 模式 (`doctor --json`)

```json
{
  "productName": "ZCode",
  "version": "1.4.0",
  "cwd": "E:\\path\\to\\cwd",
  "startable": true,
  "runtime": {
    "engine": "node",
    "node": "v24.14.0",
    "bun": null
  },
  "provider": {
    "mode": "firstParty",
    "id": "anthropic:firstParty",
    "kind": "anthropic",
    "printReady": true,
    "defaultModel": "claude-3-5-haiku-20241022",
    "modelCount": 11
  },
  "commands": ["help", "doctor", "models", "sessions", "print"],
  "notes": [
    "Legacy interactive startup is not wired in this public build.",
    "Use doctor, models, or --print to validate the local public entrypoint."
  ],
  "models": [
    { "id": "claude-3-5-haiku-20241022", "provider": "firstParty", "displayName": "claude-3-5-haiku-20241022" }
  ]
}
```

关键字段：

| 字段 | 含义 |
|------|------|
| `provider.printReady` | `true` 表示可执行 `-p` Print 模式 |
| `provider.mode` | 当前 Provider 模式 |
| `provider.modelCount` | 可用模型数量 |
| `startable` | 公共 CLI 是否可启动 |

### Models 模式 (`models --json`)

返回模型描述符数组：

```json
[
  {
    "id": "deepseek-chat",
    "provider": "openai-compatible:deepseek",
    "displayName": "deepseek-chat"
  }
]
```

---

## 环境变量

### `.env` 加载规则

1. CLI 启动时读取**当前工作目录**下的 `.env`
2. 仅当变量在 `process.env` 中**未定义**时才写入
3. 支持 `#` 注释和 `export KEY=value` 语法
4. 值可用单引号或双引号包裹

### Provider 选择

| 变量名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `ZCODE_PROVIDER` | string | 公共 CLI 推荐 | Provider 模式。Print 模式设为 `openai-compatible` |

**Provider 模式值：**

| 值 | 说明 | 公共 CLI Print |
|----|------|----------------|
| `openai-compatible` | OpenAI 兼容 API（DeepSeek/Ollama 等） | ✅ 支持 |
| `firstParty` | Anthropic 第一方 API（默认） | ✅ 支持（v1.4 双方言循环） |
| `bedrock` / `vertex` / `foundry` | 历史开关值，无第一方适配器 | ❌ 未实现 |

完整 REPL 还识别以下旧版开关（无 `ZCODE_PROVIDER` 时，仅向后兼容）：

| 变量名 | 效果 | 推荐替代 |
|--------|------|----------|
| `ZCODE_USE_BEDROCK=1` | 使用 Bedrock | `ZCODE_PROVIDER=bedrock` |
| `ZCODE_USE_VERTEX=1` | 使用 Vertex | `ZCODE_PROVIDER=vertex` |
| `ZCODE_USE_FOUNDRY=1` | 使用 Foundry | `ZCODE_PROVIDER=foundry` |

默认（均未设置）：`firstParty`

### OpenAI-compatible Provider

公共 CLI Print 模式的完整配置：

| 变量名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `ZCODE_OPENAI_PROVIDER` | string | 推荐 | 提供商标识（如 `deepseek`、`openai`、`ollama`） |
| `ZCODE_OPENAI_MODEL` | string | 推荐 | 默认模型 ID |
| `ZCODE_OPENAI_BASE_URL` | string | 是 | API Base URL |
| `ZCODE_OPENAI_API_KEY` | string | 是* | API 密钥（本地 Ollama 等可无 key） |
| `ZCODE_OPENAI_HEADERS` | JSON string | 否 | 自定义请求头 |
| `ZCODE_OPENAI_TIMEOUT` | number | 否 | 请求超时（毫秒） |

**最小配置示例：**

```dotenv
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-chat
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com/v1
ZCODE_OPENAI_API_KEY=sk-...
```

**Ollama 本地示例：**

```dotenv
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=ollama
ZCODE_OPENAI_MODEL=llama3
ZCODE_OPENAI_BASE_URL=http://localhost:11434/v1
ZCODE_OPENAI_API_KEY=ollama
```

**自定义请求头示例：**

```dotenv
ZCODE_OPENAI_HEADERS={"X-Custom-Header": "value"}
ZCODE_OPENAI_TIMEOUT=60000
```

### 品牌定制（可选）

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ZCODE_PRODUCT_NAME` | `ZCode` | 产品名称 |
| `ZCODE_WELCOME_TITLE` | `ZCode CLI Agent` | 欢迎标题 |
| `ZCODE_COMMAND_NAMESPACE` | `zcode` | CLI 命令名 |
| `ZCODE_LOGO_VARIANT` | `zcode` | Logo 变体 |
| `ZCODE_THEME` | `zcode` | 主题标识 |
| `ZCODE_DOCUMENTATION_URL` | — | 文档 URL |
| `ZCODE_PRODUCT_URL` | — | 产品 URL |
| `ZCODE_REMOTE_BASE_URL` | — | 远程服务 Base URL |
| `ZCODE_REMOTE_STAGING_BASE_URL` | — | 预发环境 URL |
| `ZCODE_REMOTE_LOCAL_BASE_URL` | — | 本地远程 URL |

---

## CLI 选项

`zcode`（即 `src/entrypoints/publicCli.js`）是唯一入口——无头 `-p` 与交互 TUI 共用同一套选项：

| 选项 | 说明 |
|------|------|
| `-m, --model <id>` | 指定模型 |
| `--json` | 机器可读 JSON 输出（`-p`） |
| `-w, --write [path]` | 将响应中的代码块写入文件 |
| `--plan` | Plan 模式：只建议不执行写入 |
| `--yolo` | YOLO 模式：自动批准全部操作 |
| `--reasoning` | 流式展示模型推理 |
| `--max-turns <n>` | 循环轮数上限（默认 30，`ZCODE_MAX_TURNS`） |
| `--continue` | 续接本工作区最近会话 |
| `--resume <id\|path>` | 恢复指定会话 |
| `--add-dir <dir>` | 信任额外目录（文件工具，可重复） |
| `--no-boundary` | 解除工作区边界 |

子命令：`help` · `doctor` · `models` · `sessions`。裸 `zcode`（TTY）启动交互 TUI；`zcode -p "<task>"` 跑无头 Agent 循环。详见 `zcode --help`。

---

## 错误处理与退出码

公共 CLI 错误写入 stderr 并以非零退出码退出：

| 场景 | 退出码 | 典型错误信息 |
|------|--------|-------------|
| 成功（`stopReason=end_turn`） | 0 | — |
| Provider/循环运行错误（`stopReason=error`） | 1 | `OpenAI-compatible request failed…` |
| 用法/参数错误 | 2 | `Unknown option: --foo` · `--plan and --write cannot be combined` · `-p requires a prompt` |
| 护栏终止（`max_turns`/`budget_exceeded`） | 3 | — |
| 用户取消（`stopReason=aborted`） | 130 | — |

---

## 相关文档

- [快速开始](../getting-started/quick-start.md)
- [本地开发指南](../guides/local-development.md)
- [Harness 契约（CLI/JSON/配置）](../harness/contracts/23-cli-json-config-contract.md)

*最后更新：2026-09-05（v1.4.0 + P0 可靠性闭环）*
