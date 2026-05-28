# 本地开发环境配置

## 系统要求

- Node.js >= 18.x
- Bun >= 1.0.x

## 安装步骤

### 1. 安装 Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

### 2. 安装依赖

```bash
cd ZCode
bun install
```

### 3. 配置环境变量

创建 `.env` 文件：

```dotenv
# OpenAI-compatible Provider 配置
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-chat
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com/v1
ZCODE_OPENAI_API_KEY=your-api-key

# 可选配置
ZCODE_OPENAI_HEADERS={"X-Custom-Header": "value"}
ZCODE_OPENAI_TIMEOUT=30000
```

### 4. 验证安装

```bash
bun run doctor --json
```

## 可用命令

| 命令 | 描述 |
|------|------|
| `bun run start --help` | 显示帮助信息 |
| `bun run doctor --json` | 诊断系统状态 |
| `bun run models` | 列出可用模型 |
| `bun run start -p "prompt" --json` | 执行非交互式请求 |

## 常见问题

### Q: 环境变量不生效？

确保 `.env` 文件位于当前工作目录，且变量名正确。环境变量优先级：系统环境 > `.env` 文件。

### Q: 如何使用其他模型提供商？

修改 `ZCODE_OPENAI_PROVIDER` 和 `ZCODE_OPENAI_BASE_URL` 配置即可。