# ZCode 源码目录

> 公共 CLI 本地启动说明 — 完整文档见 [文档中心](../docs/README.md)。

[← 项目主页](../README_ZH.md) · [快速开始](../docs/getting-started/quick-start.md) · [API 参考](../docs/references/api-reference.md) · [系统设计](../docs/系统设计说明书.md)

---

## 这是什么？

`ZCode/` 是 ZCode CLI Agent 的核心源码。自 v1.4 起仓库只含**第一方公共层**代码（此前的设计参考树已整体移除）。

| 入口 | 文件 | 状态 |
|------|------|------|
| **公共 CLI** | `src/entrypoints/publicCli.js` | ✅ 稳定 |

`publicCli.js` 是 `zcode` bin 的入口：headless `-p` 循环、`doctor`、`models`、`sessions` 与交互式 TUI 都由它驱动。

---

## 前置条件

- Node.js ≥ 24（必需，原生 TS 类型剥离，零构建）
- Bun（可选，用于便捷脚本）

---

## 快速启动

```bash
npm install

# 公共 CLI（Node）
npm start -- --help
npm run doctor -- --json
npm run models

# 公共 CLI（Bun，可选）
bun run start --help

# 新增 CLI 标志
npm start -- -p "..." --plan        # 仅分析，不执行
npm start -- -p "..." --write out.py
npm start -- -p "..." --reasoning   # 流式展示推理过程
npm start -- -p "..." --yolo        # 自动批准
```

---

## 交互式 REPL（零依赖 TUI）

```bash
zcode
```

裸 `zcode` 在真实 TTY 上启动交互式 TUI（`publicCli.js` → `cli/tui.js`）：流式输出、内联工具审批、斜杠命令、会话恢复。

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

配置好 Provider 后：

```bash
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

## 测试

```bash
npm test
```

验证内容：harness 循环（真循环 + 假 LLM + 真工具）、provider 适配（Anthropic / OpenAI 兼容）、权限门、护栏、转录、压缩、恢复、TUI、公共 CLI 契约。

---

## npm scripts

| Script | 说明 |
|--------|------|
| `start` | 公共 CLI 入口 |
| `doctor` | 环境诊断 |
| `models` | 列出模型 |
| `test` | 运行测试（`test/all.test.js`，全量公共层套件） |
| `test:watch` | 监听模式测试 |
| `typecheck` | 公共层 strict TS 检查 |
| `lint` | 公共层 ESLint |

---

## 目录结构

```
src/
├── entrypoints/publicCli.js   node 入口（zcode bin）
├── cli/                       公共 CLI 核心 + 交互 TUI（publicCliCore, harnessPrint, tui）
├── harness/                   Agent 循环、六件套工具、权限门、护栏、转录、压缩、恢复
├── providers/                 Provider 适配（Anthropic + OpenAI 兼容）
├── contracts/                 Provider 契约
├── config/                    品牌、settings、provider 环境
└── utils/                     runMode（运行模式）、model/（模型目录）
test/
└── *.test.js                  公共层测试
```

---

*更多文档：[docs/](../docs/README.md)* · *最后更新：2026-09-03*
