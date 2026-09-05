# 50 开发环境

> Status: guide · Owner: harness maintainers · Last verified: 2026-09-05（Windows 10.0.26100 / Node v24.14.0）

## 前置

| 项 | 要求 |
|---|---|
| OS | Windows 10/11 主路径（其他平台尽力而为，CI 只保 Windows） |
| Node | ≥ 24（原生 TS 类型剥离；不需要 ts-node/构建） |
| Git Bash | 必需（Bash 工具与大量测试依赖 `bash -c`） |
| 包管理 | npm（仓库内含 package-lock.json；ZCode/ 另有 bun.lock 供 Bun 侧实验，非主路径） |

## 常用命令（一律在 `ZCode/` 目录执行）

```bash
cd ZCode
npm ci            # 或 npm install
npm test          # 全量套件（目标 <60s，确定性，零网络）
npm run typecheck # strict，公共层
npm run lint      # eslint，公共层
npm start -- doctor --json   # 冒烟
npm start -- models --json
```

## 首次运行验证清单

1. `npm run typecheck` 0 error
2. `npm run lint` 0 error
3. `npm test` 0 fail
4. `doctor --json`：startable=true、printReady=true、模型数 >0
5. 配置 `.env`（DeepSeek/OpenAI 兼容或 Anthropic key）后：`zcode -p "1+1?" --json` 真实跑通

## 开发循环（Loop Engineering 节奏）

```text
小步改动 → npm run typecheck && npm run lint && npm test
→ 全绿才进行下一改动；失败就地修复；不可定位 → 回退该步改动
```

## 禁区

- 不从仓库根目录跑 npm（根 package.json 不是运行时入口）。
- 不引入新运行时依赖（零依赖红线；devDependencies 需评审）。
- 不把 API key 写进项目 settings / 测试 / 文档。
- live e2e（test/e2e）需要真实 key：本地自愿，CI 不强制。
