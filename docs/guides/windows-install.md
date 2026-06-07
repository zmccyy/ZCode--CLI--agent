# Windows 安装指南

本文说明如何在 Windows 10/11 上安装 **ZCode 公共 CLI**（`zcode` 命令）。

## 环境要求

- [Node.js](https://nodejs.org/) **22 或更高版本**
- Windows 10/11

验证 Node：

```powershell
node -v
```

## 方式一：便携 ZIP + 安装脚本（推荐）

### 1. 获取安装包

从 [GitHub Releases](https://github.com/zmccyy/ZCode--CLI--agent/releases) 下载 `zcode-*-win-x64-portable.zip`，或在仓库中自行构建：

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\build-portable.ps1
```

### 2. 安装到用户目录

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\install.ps1 -ZipPath .\dist\zcode-0.1.0-win-x64-portable.zip
```

安装位置：`%LOCALAPPDATA%\ZCode`，并将 `bin` 目录加入用户 PATH。

### 3. 验证

**重新打开**终端后执行：

```powershell
zcode --help
zcode doctor --json
```

## 方式二：仅便携运行（不改 PATH）

解压 ZIP 后，在解压目录执行：

```powershell
.\bin\zcode.cmd --help
.\bin\zcode.cmd -p "总结当前目录" --json
```

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\uninstall.ps1
```

## 配置 API Key

在**当前工作目录**创建 `.env`（参见 [API 参考](../references/api-reference.md)）：

```dotenv
ZCODE_PROVIDER=openai-compatible
ZCODE_OPENAI_PROVIDER=deepseek
ZCODE_OPENAI_MODEL=deepseek-chat
ZCODE_OPENAI_BASE_URL=https://api.deepseek.com/v1
ZCODE_OPENAI_API_KEY=your-api-key
```

## 完整交互式 REPL

公共安装包**不包含**完整 Ink TUI。若需 REPL，请从源码使用 Bun 启动，参见 [本地开发](local-development.md)。

## 故障排除

| 现象 | 处理 |
|------|------|
| `'zcode' 不是内部或外部命令` | 关闭并重新打开终端；检查用户 PATH 是否包含 `%LOCALAPPDATA%\ZCode\bin` |
| 提示 Node.js 未找到 | 安装 Node 22+ 并确认 `node` 在 PATH 中 |
| `doctor` 显示 provider 未配置 | 在工作目录添加 `.env` 或设置对应环境变量 |

更多打包细节见 [packaging/windows/README.md](../../packaging/windows/README.md)。
