# 本地开发环境配置

## 系统要求

- Node.js >= 22.x
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

先验证 Node 公共 CLI：

```bash
cd ZCode
npm start -- --help
npm run doctor -- --json
```

再验证 Bun 主链路和 Bun 版公共入口：

```bash
bun run start --help
bun run doctor --json
```

## 可用命令

| 命令 | 描述 |
|------|------|
| `npm start -- --help` | 通过 Node.js 运行公共 CLI 帮助 |
| `npm run doctor -- --json` | 通过 Node.js 运行公共 CLI 诊断 |
| `bun run start --help` | 通过 Bun 运行公共 CLI 帮助 |
| `bun run doctor --json` | 通过 Bun 运行公共 CLI 诊断 |
| `bun run models` | 列出可用模型 |
| `bun run start -p "prompt" --json` | 执行非交互式请求 |
| `bun src/entrypoints/cli.tsx` | 启动完整 Bun REPL 主链路 |

## 常见问题

### Q: 环境变量不生效？

确保 `.env` 文件位于当前工作目录，且变量名正确。环境变量优先级：系统环境 > `.env` 文件。

### Q: Node.js 和 Bun 分别负责什么？

- Node.js：稳定公共 CLI 入口，适合 `--help` / `doctor` / `models` / `-p --json`
- Bun：完整 `cli.tsx -> main.tsx -> REPL.tsx` 主链路运行时

### Q: 如何使用其他模型提供商？

修改 `ZCODE_OPENAI_PROVIDER` 和 `ZCODE_OPENAI_BASE_URL` 配置即可。
