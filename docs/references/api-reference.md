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
| `-p, --print <prompt>` | 非交互式提问并输出结果 |

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
  "messageId": "msg_abc123",
  "text": "模型回复的完整文本",
  "toolCalls": [],
  "finishReason": "stop"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | string | Provider 标识 |
| `model` | string | 实际使用的模型 |
| `messageId` | string \| null | 消息 ID（Provider 返回时填充） |
| `text` | string | 模型文本回复 |
| `toolCalls` | array | 工具调用列表（Print 模式通常为空） |
| `finishReason` | string | 结束原因：`stop` · `tool_call` · `error` |

非 JSON 模式下，`-p` 仅输出 `text` 或 `toolCalls` 的字符串形式。

### Doctor 模式 (`doctor --json`)

```json
{
  "productName": "ZCode",
  "version": "0.1.0",
  "cwd": "/path/to/cwd",
  "startable": true,
  "runtime": {
    "engine": "bun",
    "node": "v22.0.0",
    "bun": "1.2.0"
  },
  "provider": {
    "mode": "openai-compatible",
    "id": "openai-compatible:deepseek",
    "kind": "openai-compatible",
    "printReady": true,
    "defaultModel": "deepseek-chat",
    "modelCount": 1
  },
  "commands": ["help", "doctor", "models", "print"],
  "notes": [
    "Legacy interactive startup is not wired in this public build.",
    "Use doctor, models, or --print to validate the local public entrypoint."
  ],
  "models": [
    {
      "id": "deepseek-chat",
      "provider": "openai-compatible:deepseek",
      "displayName": "deepseek-chat"
    }
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
| `openai-compatible` | OpenAI 兼容 API | ✅ 支持 |
| `firstParty` | Anthropic 第一方 API | ❌ 需完整 REPL |
| `bedrock` | AWS Bedrock | ❌ 需完整 REPL |
| `vertex` | Google Vertex AI | ❌ 需完整 REPL |
| `foundry` | Azure Foundry | ❌ 需完整 REPL |

完整 REPL 还识别以下旧版开关（无 `ZCODE_PROVIDER` 时）：

| 变量名 | 效果 |
|--------|------|
| `CLAUDE_CODE_USE_BEDROCK=1` | 使用 Bedrock |
| `CLAUDE_CODE_USE_VERTEX=1` | 使用 Vertex |
| `CLAUDE_CODE_USE_FOUNDRY=1` | 使用 Foundry |

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

## 完整 REPL CLI 选项（参考）

通过 `bun src/entrypoints/cli.tsx` 启动的完整 CLI 支持更多选项，公共构建未暴露：

| 选项 | 说明 |
|------|------|
| `-p, --print` | 打印模式（完整链路版） |
| `-c, --continue` | 继续最近会话 |
| `-r, --resume [id]` | 恢复指定会话 |
| `--model <model>` | 选择模型 |
| `--permission-mode <mode>` | 权限模式 |
| `--mcp-config <configs...>` | 加载 MCP 配置 |
| `--agent <agent>` | 指定 Agent |
| `--ide` | 启动时连接 IDE |

子命令包括 `mcp`、`auth`、`doctor`、`update`、`plugin` 等。详见 `bun src/entrypoints/cli.tsx --help`。

---

## 错误处理

公共 CLI 错误写入 stderr 并以非零退出码退出：

| 场景 | 典型错误信息 |
|------|-------------|
| 未知选项 | `Unknown option: --foo` |
| Print 未配置 Provider | `Provider ... is not ready for local print mode. Configure ZCODE_PROVIDER=openai-compatible...` |
| 未知子命令 | `Unknown command: foo` |
| 缺少 prompt | `-p requires a prompt` |

---

## 相关文档

- [快速开始](../getting-started/quick-start.md)
- [本地开发指南](../guides/local-development.md)
- [系统设计说明书 — 接口设计](../系统设计说明书.md#6-接口设计)

*最后更新：2026-05-31*
