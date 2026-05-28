# 快速开始

## 前置条件

确保已安装以下依赖：
- **bun** - JavaScript 运行时
- **node** - Node.js 环境

## 本地启动

进入项目目录后执行：

```bash
cd ZCode
bun run start --help
bun run doctor --json
bun run models
```

## 环境配置

创建 `.env` 文件配置模型 provider：

```dotenv
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-chat
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com/v1
ZCODE_OPENAI_API_KEY=your-api-key
```

## 非交互模式

配置完成后可以发起请求：

```bash
bun run start -p "Summarize this repository" --json
```

## 测试验证

```bash
node --experimental-strip-types --test test/all.test.js
```