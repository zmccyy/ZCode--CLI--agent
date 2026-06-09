# ZCode Windows 安装包

面向 **公共 CLI**（`help` / `doctor` / `models` / `-p`）的 Windows 便携包与安装脚本，对应开发计划 Phase 3 W15-16。

## 前置条件

- **Node.js ≥ 22**（用户机器需已安装；安装包不捆绑 Node 运行时）
- **Windows 10/11**
- 构建机额外需要：**npm**、PowerShell 5.1+

## 构建便携 ZIP

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\build-portable.ps1
```

产物：`dist/zcode-<version>-win-x64-portable.zip`

可选参数：

| 参数 | 说明 |
|------|------|
| `-Version "0.1.0"` | 覆盖版本号 |
| `-OutputDir "D:\out"` | 指定输出目录 |
| `-SkipNpmInstall` | 跳过 `npm ci --omit=dev`（已装好依赖时） |

## 安装（用户）

### 从 ZIP 安装到 `%LOCALAPPDATA%\ZCode`

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\install.ps1 -ZipPath .\dist\zcode-0.1.0-win-x64-portable.zip
```

安装脚本会：

1. 解压到 `%LOCALAPPDATA%\ZCode`（`app/` + `bin/`）
2. 将 `%LOCALAPPDATA%\ZCode\bin` 加入**用户 PATH**
3. 运行 `zcode --help` 做冒烟验证

### 便携模式（不改 PATH）

解压 ZIP 后：

```powershell
.\bin\zcode.cmd --help
.\bin\zcode.cmd doctor --json
```

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\uninstall.ps1
```

## 目录结构

```
zcode-0.1.0-win-x64-portable/
├── app/                 # ZCode 应用（src、package.json、node_modules）
├── bin/
│   ├── zcode.cmd        # CMD 入口
│   └── zcode.ps1        # PowerShell 入口
├── install.ps1
├── uninstall.ps1
├── VERSION
├── LICENSE
└── README-PORTABLE.txt
```

## 与 GitHub Release 对接

1. 在 CI 或本地运行 `build-portable.ps1`
2. 将 `dist/*.zip` 上传为 Release 资产
3. 用户下载后执行包内或仓库中的 `install.ps1 -ZipPath <path>`

一行安装（Release 发布后替换版本与 URL）：

```powershell
irm https://github.com/zmccyy/ZCode--CLI--agent/releases/download/v0.1.0/zcode-0.1.0-win-x64-portable.zip -OutFile $env:TEMP\zcode.zip
powershell -ExecutionPolicy Bypass -File packaging\windows\install.ps1 -ZipPath $env:TEMP\zcode.zip
```

## 范围说明

| 包含 | 不包含 |
|------|--------|
| 公共 CLI `zcode` 命令 | 完整 Ink REPL（需 Bun，见本地开发文档） |
| PATH 注册、便携 ZIP | MSI 签名安装包（后续可选） |
| Node 22+ 运行时检测 | 捆绑 Node 二进制（后续可选 `pkg`/SEA） |

## 后续（可选）

- GitHub Actions `windows-latest` 自动构建并上传 Release
- MSI / Inno Setup 图形安装向导
- 捆绑 Node LTS 或单文件可执行（`pkg` / Node SEA）
