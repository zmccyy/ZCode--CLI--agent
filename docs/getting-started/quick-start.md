# 快速开始

> 5 分钟完成克隆、配置 Provider，并发出第一条 AI 请求。

[← 文档中心](../README.md) · [本地开发详解](../guides/local-development.md) · [API 参考](../references/api-reference.md)

---

## 前置条件

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Node.js** | ≥ 22 | 运行公共 CLI（必需） |
| **Bun** | ≥ 1.0 | 完整 REPL 与更快启动（推荐） |
| **Git** | 任意 | 克隆仓库 |

---

## 1. 克隆并安装

```bash
git clone https://github.com/zmccyy/ZCode--CLI--agent.git
cd ZCode--CLI--agent/ZCode
bun install
# 若无 Bun：npm install
```

---

## 2. 配置 Provider

在**当前工作目录**（你运行命令的目录）创建 `.env`：

```dotenv
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-chat
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com/v1
ZCODE_OPENAI_API_KEY=your-api-key
```

> **优先级：** 已存在于进程中的环境变量 **不会** 被 `.env` 覆盖。

其他 OpenAI 兼容服务只需改 `ZCODE_OPENAI_PROVIDER`、`ZCODE_OPENAI_BASE_URL` 和 `ZCODE_OPENAI_MODEL`。完整变量表见 [API 参考](../references/api-reference.md)。

---

## 3. 验证环境

```bash
bun run doctor --json
```

期望看到 `"printReady": true` 且 `modelCount` ≥ 1：

```json
{
  "productName": "ZCode",
  "version": "0.1.0",
  "startable": true,
  "provider": {
    "mode": "openai-compatible",
    "printReady": true,
    "modelCount": 1
  }
}
```

Node.js 等效命令：

```bash
npm run doctor -- --json
```

---

## 4. 发起第一条请求

```bash
bun run start -p "用三句话总结这个仓库" --json
```

输出包含 `text`（模型回复）、`provider`、`model` 和 `finishReason`：

```json
{
  "provider": "openai-compatible:deepseek",
  "model": "deepseek-chat",
  "messageId": "...",
  "text": "ZCode CLI Agent 是一个终端原生 AI 编程助手...",
  "toolCalls": [],
  "finishReason": "stop"
}
```

---

## 5. （可选）全局安装

```bash
cd ZCode
npm link
```

之后任意目录可用：

```bash
zcode -p "Explain this repo" --json
zcode doctor --json
zcode models
```

---

## 两种运行模式

### 公共 CLI — 稳定入口

适合诊断、自动化脚本和 CI：

```bash
bun run start --help      # 帮助
bun run doctor --json     # 环境诊断
bun run models            # 列出模型
bun run start -p "..." --json   # 非交互请求
```

Node.js 路径：`npm start -- --help`、`npm run doctor -- --json`。

### 完整 REPL — 交互式 TUI

```bash
bun src/entrypoints/cli.tsx
```

包含 MCP 管理、认证、插件、Skills、会话恢复及完整工具循环。该链路仍在积极开发中，部分模块可能依赖尚未就绪的组件。

---

## 常用命令速查

| 命令 | 作用 |
|------|------|
| `--help` / `-h` | 显示帮助 |
| `--version` / `-v` | 显示版本 |
| `doctor [--json]` | 运行时与 Provider 诊断 |
| `models [--json]` | 列出可用模型 |
| `-p, --print <prompt> [--json]` | 非交互式提问 |
| `-m, --model <id>` | 指定模型（配合 `-p`） |

---

## 测试验证

```bash
cd ZCode
bun test
# 或
npm test
```

测试覆盖：Provider 桥接、CLI 契约、`.env` 加载、`-p --json` 真实请求链路。

---

## 下一步

- 深入配置开发环境 → [本地开发指南](../guides/local-development.md)
- 查阅完整 CLI 契约 → [API 参考](../references/api-reference.md)
- 了解系统架构 → [系统设计说明书](../系统设计说明书.md)

---

## 常见问题

**Q: `printReady` 为 false？**

确认 `ZCODE_PROVIDER=openai-compatible` 且 `ZCODE_OPENAI_BASE_URL`、`ZCODE_OPENAI_API_KEY` 已设置。

**Q: Bun 和 Node.js 选哪个？**

公共 CLI 两者均可。完整 REPL 推荐 Bun。

**Q: 完整 TUI 和公共 CLI 有什么区别？**

公共 CLI 只暴露 `help`、`doctor`、`models`、`-p`，不启动 Ink 界面。完整 Agent 体验走 `cli.tsx` 入口。
