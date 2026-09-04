# 本地开发环境配置

> 从零搭建 ZCode 开发环境，区分 Node 公共 CLI 与 Bun 完整 REPL 两条链路。

[← 文档中心](../README.md) · [快速开始](../getting-started/quick-start.md) · [API 参考](../references/api-reference.md)

---

## 系统要求

| 组件 | 最低版本 | 用途 |
|------|----------|------|
| Node.js | 22.x | 公共 CLI、测试运行 |
| Bun | 1.0.x | 完整 REPL、依赖安装（推荐） |
| Git | 2.x | 版本管理 |

目标平台以 **Windows 10/11** 为主，macOS / Linux 同样可用。

---

## 安装步骤

### 1. 安装 Node.js

从 [nodejs.org](https://nodejs.org/) 安装 LTS 或 Current（≥ 22）。

验证：

```bash
node --version   # v22.x 或更高
```

### 2. 安装 Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

验证：

```bash
bun --version
```

### 3. 克隆仓库

```bash
git clone https://github.com/zmccyy/ZCode--CLI--agent.git
cd ZCode--CLI--agent
```

### 4. 安装依赖

```bash
cd ZCode
bun install
```

无 Bun 时：

```bash
npm install
```

### 5. 配置环境变量

在**工作目录**（运行 CLI 的目录，通常是 `ZCode/` 或你的项目根）创建 `.env`：

```dotenv
# ── OpenAI-compatible Provider（公共 CLI Print 模式）──
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-chat
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com/v1
ZCODE_OPENAI_API_KEY=your-api-key

# ── 可选 ──
ZCODE_OPENAI_HEADERS={"X-Custom-Header": "value"}
ZCODE_OPENAI_TIMEOUT=30000
```

> ⚠️ **切勿** 将含真实 API Key 的 `.env` 提交到 Git。

### 6. 验证安装

**Node.js 公共 CLI：**

```bash
cd ZCode
npm start -- --help
npm run doctor -- --json
```

**Bun 公共 CLI：**

```bash
bun run start --help
bun run doctor --json
bun run models
```

**交互式 TUI：**

```bash
zcode
```

---

## 单入口，两种表面

```
┌─────────────────────────────────────────────────────────┐
│  publicCli.js（Node ≥24）                                │
│  ├─ 无头: help / doctor / models / sessions / -p        │
│  └─ 交互: 裸 `zcode`（TTY）→ 零依赖 readline TUI         │
│  ✅ 稳定 · 适合 CI 与脚本                                │
└─────────────────────────────────────────────────────────┘
```

| 表面 | 入口 | 运行时 | 典型用途 |
|------|----------|--------|----------|
| 无头 CLI | `src/entrypoints/publicCli.js` | Node ≥24 | 诊断、自动化、`-p --json` |
| 交互 TUI | 裸 `zcode`（TTY）→ `cli/tui.js` | Node ≥24 | 流式输出、内联审批、斜杠命令 |

---

## 可用命令

### npm scripts（`ZCode/package.json`）

| 命令 | 等价调用 | 说明 |
|------|----------|------|
| `npm start -- --help` | `node src/entrypoints/publicCli.js --help` | 帮助 |
| `npm run doctor -- --json` | `... doctor --json` | 诊断 |
| `npm run models` | `... models` | 列模型 |
| `npm start -- -p "..." --json` | `... -p "..." --json` | Print 模式 |
| `npm test` | `node --experimental-strip-types --test test/all.test.js` | 测试 |

### Bun scripts

| 命令 | 说明 |
|------|------|
| `bun run start --help` | 公共 CLI 帮助 |
| `bun run doctor --json` | 诊断 |
| `bun run models` | 列模型 |
| `bun run start -p "..." --json` | Print 模式 |
| `zcode` | 交互式 TUI（TTY） |

### 全局命令（`npm link` 后）

```bash
zcode --help
zcode doctor --json
zcode models
zcode -p "Explain this repo" --json
```

---

## 项目结构（开发视角）

```
ZCode--CLI--agent/
├── README.md / README_ZH.md    # 项目主页
├── docs/                       # 文档中心
└── ZCode/
    ├── src/
    │   ├── entrypoints/        # CLI 入口（publicCli / cli.tsx）
    │   ├── cli/                # 公共 CLI 核心逻辑
    │   ├── providers/          # LLM Provider 适配
    │   ├── tools/              # Agent 工具
    │   ├── main.tsx            # 完整 CLI 命令注册
    │   └── ...
    ├── test/                   # 集成测试
    └── package.json
```

---

## 运行测试

```bash
cd ZCode
bun test
# 或
npm test

# 监听模式
npm run test:watch
```

测试验证内容：

- Provider / runtime 兼容桥接
- 公共 CLI 的 `help` / `doctor` / `models` 契约
- 本地 `.env` 加载行为
- Harness 循环（真循环 + 假 LLM + 真工具）、Provider 适配、权限门、护栏、转录、压缩、恢复、TUI
- 全量公共层套件（`npm test`）通过

---

## 调试技巧

### 检查 Provider  wiring

```bash
bun run doctor --json | jq '.provider'
```

关注 `printReady`、`mode`、`modelCount`。

### Print 模式快速冒烟

```bash
bun run start -p "Reply with exactly: OK" --json
```

### REPL 启动诊断

完整 REPL 若卡住，参考内部文档 [T2.2 REPL 启动分析](../ai-interactions/T2.2-repl-startup-hang-analysis.md)。

---

## 常见问题

### Q: 环境变量不生效？

1. 确认 `.env` 在**当前工作目录**（`process.cwd()`），不是仓库根目录以外的错误位置
2. 变量名拼写正确（见 [API 参考](../references/api-reference.md)）
3. 系统环境变量已存在时，`.env` **不会**覆盖 — 先 `echo $ZCODE_OPENAI_API_KEY`（或 Windows 等效）检查

### Q: Node.js 和 Bun 分别负责什么？

- **Node.js**：稳定公共 CLI，适合 CI、`--help`、`doctor`、`models`、`-p --json`
- **Bun**：完整 `cli.tsx → main.tsx → REPL` 主链路，启动更快，支持 TS/TSX 直跑

### Q: 如何切换模型 Provider？

修改 `.env` 中 `ZCODE_OPENAI_PROVIDER`、`ZCODE_OPENAI_BASE_URL`、`ZCODE_OPENAI_MODEL` 即可。示例：

```dotenv
# OpenAI 官方
ZCODE_OPENAI_PROVIDER=openai
ZCODE_OPENAI_BASE_URL=https://api.openai.com/v1
ZCODE_OPENAI_MODEL=gpt-4o

# 本地 Ollama
ZCODE_OPENAI_PROVIDER=ollama
ZCODE_OPENAI_BASE_URL=http://localhost:11434/v1
ZCODE_OPENAI_MODEL=llama3
```

### Q: 完整 REPL 报模块缺失？

公共构建是刻意裁剪的稳定子集。完整 TUI 链路依赖更多模块，部分仍在开发中。先用公共 CLI 验证 Provider 配置是否正确。

### Q: 如何贡献代码？

1. Fork 仓库
2. 创建功能分支
3. 确保 `npm test` 通过
4. 提交 Pull Request

---

## 相关链接

- [快速开始](../getting-started/quick-start.md)
- [API 参考](../references/api-reference.md)
- [系统设计说明书](../系统设计说明书.md)
- [ZCode 源码 README](../../ZCode/README.md)

*最后更新：2026-06-01*
