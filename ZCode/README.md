# ZCode Local Startup

这个仓库当前提供的是一条“最小可本地启动”的公共 CLI 入口。
它不会启动原始的大型交互式 TUI 链路，因为那条链路在这个裁剪仓库里仍然依赖缺失模块。

## 前置条件

- 已安装 `bun`
- 已安装 `node`

## 本地启动

进入 [ZCode](/D:/桌面/项目/agent壳/ZCode) 后执行：

```bash
bun run start --help
bun run doctor --json
bun run models
```

当前可用命令：

- `bun run start --help`
- `bun run doctor --json`
- `bun run models`
- `bun run start -p "Explain this repo" --json`

## .env 支持

CLI 会优先读取当前工作目录下的 `.env` 文件，再解析 provider 配置。
如果某个变量已经存在于当前进程环境中，`.env` 不会覆盖它。

最小示例：

```dotenv
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-chat
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com/v1
ZCODE_OPENAI_API_KEY=your-api-key
```

支持的 OpenAI-compatible 变量：

- `ZCODE_PROVIDER`
- `ZCODE_OPENAI_PROVIDER`
- `ZCODE_OPENAI_MODEL`
- `ZCODE_OPENAI_BASE_URL`
- `ZCODE_OPENAI_API_KEY`
- `ZCODE_OPENAI_HEADERS`
- `ZCODE_OPENAI_TIMEOUT`

## 非交互打印模式

当 `.env` 或环境变量里配置好 OpenAI-compatible provider 后，可以真正发起请求：

```bash
bun run start -p "Summarize this repository" --json
```

如果你把包链接成了全局命令，也可以这样用：

```bash
zcode -p "Summarize this repository" --json
```

当前 JSON 输出包含：

- `provider`
- `model`
- `messageId`
- `text`
- `toolCalls`
- `finishReason`

## 测试验证

```bash
node --experimental-strip-types --test test/all.test.js
```

这会验证：

- provider/runtime 兼容桥接
- 公共 CLI 的 help/doctor/start 契约
- 本地 `.env` 加载
- `-p --json` 真实走 OpenAI-compatible provider 请求链路
