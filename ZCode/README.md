# ZCode 源码目录

> 公共 CLI 本地启动说明 — 完整文档见 [文档中心](../docs/README.md)。

[← 项目主页](../README_ZH.md) · [快速开始](../docs/getting-started/quick-start.md) · [API 参考](../docs/references/api-reference.md)

---

## 这是什么？

`ZCode/` 是 ZCode CLI Agent 的核心源码。当前仓库提供两条入口：

| 入口 | 文件 | 状态 |
|------|------|------|
| **公共 CLI** | `src/entrypoints/publicCli.js` | ✅ 稳定 |
| **完整 REPL** | `src/entrypoints/cli.tsx` | 🔧 开发中 |

公共 CLI 是刻意裁剪的最小可启动路径 — 不 boot 完整 Ink TUI，只依赖稳定模块。

---

## 前置条件

- Node.js ≥ 22（必需）
- Bun ≥ 1.0（推荐，完整 REPL 必需）

---

## 快速启动

```bash
# 安装依赖
bun install

# 公共 CLI
bun run start --help
bun run doctor --json
bun run models

# Node.js 等效
npm start -- --help
npm run doctor -- --json
```

---

## 配置 `.env`

CLI 读取**当前工作目录**下的 `.env`。已存在于进程中的变量不会被覆盖。

```dotenv
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-chat
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com/v1
ZCODE_OPENAI_API_KEY=your-api-key
```

支持的变量完整列表 → [API 参考](../docs/references/api-reference.md)

---

## 非交互 Print 模式

配置好 OpenAI-compatible Provider 后：

```bash
bun run start -p "Summarize this repository" --json
# 或
npm start -- -p "Summarize this repository" --json
```

JSON 输出字段：`provider` · `model` · `messageId` · `text` · `toolCalls` · `finishReason`

---

## 全局安装

```bash
npm link
zcode -p "Explain this repo" --json
```

---

## 完整 REPL

```bash
bun src/entrypoints/cli.tsx
```

启动 Ink 交互界面，包含 MCP、认证、插件、工具循环等。部分模块可能尚未就绪。

---

## 测试

```bash
bun test
# 或
npm test
```

验证内容：

- Provider / runtime 兼容桥接
- 公共 CLI 的 help / doctor / start 契约
- 本地 `.env` 加载
- `-p --json` 真实请求链路

---

## npm scripts

| Script | 说明 |
|--------|------|
| `start` | 公共 CLI 入口 |
| `doctor` | 环境诊断 |
| `models` | 列出模型 |
| `test` | 运行测试 |
| `test:watch` | 监听模式测试 |

---

## 目录结构

```
src/
├── entrypoints/     publicCli.js · cli.tsx · sdk/
├── cli/             公共 CLI 核心 (publicCliCore.js)
├── providers/       LLM Provider 适配层
├── tools/           Agent 工具实现
├── main.tsx         完整 CLI 命令注册
└── ...
test/
└── all.test.js      集成测试
```

---

*更多文档：[docs/](../docs/README.md)*
