# 14 工具、权限与边界

> Status: normative · Owner: harness maintainers · Last verified: 2026-09-05（v1.4.0）
> Code refs: `ZCode/src/harness/tools/`（read/glob/grep/write/edit/bash/fsWalk/registry/index）、`permissions.ts`、`bashPolicy.ts`、`boundary.ts`
> Test refs: `test/harness/tools.test.js`、`boundary.test.js`、`bashPolicy.test.js`、`m2Security.test.js`

## 核心工具语义（当前实现 = 契约）

| 工具 | 语义 | 前置条件 | readOnly |
|---|---|---|---|
| Read | 行号分页读取；拒绝二进制；记录 `state.readFiles` | — | ✅ |
| Glob | 递归模式匹配（picomatch），跳过 node_modules/.git/dist，深度 64、≤20k 条目 | — | ✅ |
| Grep | 正则搜索，content/files_with_matches/count 三模式 | — | ✅ |
| Write | 创建或覆盖文件；成功后把路径加入 `state.readFiles` | **语义见下节（P0-C 裁决）** | ❌ |
| Edit | `old_string` 精确唯一匹配替换；默认要求唯一 | **必须先 Read 同一文件**（read-before-edit） | ❌ |
| Bash | `bash -c`；timeout 1s–600s；输出截断；stderr/exit code 回灌 | bashPolicy 分类 | ❌ |

**文档歧义裁决（P0-C 执行）**：README 曾写“Edit/Write 强制 read-before-edit”，实现上仅 Edit 强制。裁决：**Write 覆盖已存在文件前必须 Read（新建文件豁免）**，代码、类型注释、README、测试四处同步。

## 权限门（permissions.ts）

```text
请求 → [Bash? → classifyBashCommand]
       deny  → 所有模式（含 YOLO）拒绝，提示用户自行执行
       allow → plan 之外免审批
       ask   → YOLO 自动执行 / Agent 审批 / Plan 拒绝
     → readOnly? → plan/agent 免审批
     → plan     → 拒绝并给出只读引导
     → agent    → confirm 回调；**无审批者 fail-closed**
     → yolo     → 放行（deny 已在上游拦截）
```

不变量：
1. Agent 模式无 `confirm` 时非只读调用一律拒绝（fail-closed，不可配置关闭）。
2. deny 优先于一切模式。
3. 权限拒绝产生 model-visible 错误结果 + transcript `permission_denied` 条目。

## Bash 策略（bashPolicy.ts）

- 三桶：allow（保守只读 allowlist）/ deny（危险 regex）/ ask（其余）。
- `ZCODE_BASH_ALLOW` / `ZCODE_BASH_DENY` 环境变量扩展。
- **它不是 sandbox**：无法理解任意 shell 语义（变量展开、编码、间接执行）；防线地位 = 第一道分类门 + 审计依据。真正隔离见 P2 sandbox-runtime（roadmap）。

## P0-C 目标：boundary 从词法升级为 realpath

当前（`boundary.ts:41-48`）：`path.normalize` + `relative` 判定——词法安全，非文件系统安全。已知缺口 C1/C2（01 篇缺陷表）。

目标契约：

1. **解析语义**：对目标路径逐级 realpath（最近的已存在祖先 + 余下词法段拼接），任一级逃出可信根 → 拒绝。
2. **默认不跟随 symlink**：遍历（fsWalk）遇到 symlink → 不下钻、不产出；跟随必须显式选项 + cycle 检测。
3. **遍历预算**：深度/条目数/累计字节/耗时四上限，超限返回明确错误（不是静默截断）；cycle 不再无限递归。
4. **目标类型明确**：Glob/Grep 的 `path` 指向文件时返回明确结果或错误；被取消时返回 aborted 而非空结果。
5. **Windows 专项**：junction、大小写不敏感路径、盘符大小写、UNC 路径各有回归用例。

## 取消贯穿（P0-B 目标，缺陷 B2/B3）

- `ToolContext.signal` 必须被每个工具尊重：Bash → kill 子进程树；Glob/Grep → walk 可中断；Read/Write/Edit → 至少在入口检查。
- 工具被取消返回 `isError: true` 且内容注明 `aborted`，loop 停止后续工具。

## 输出预算（P1 实装，方向在此固定）

- 每工具输出上限（建议默认 32KB，可配置），超限截断 + `[truncated]` 标注。
- Grep content 单行字节上限；Read 单次页面上限（现状理论 ~4MB 过大）。
- 截断必须对 model-visible 与 transcript 一致。

## Security notes

- 文件工具全部经由 `resolveWorkspacePath`（boundary + addDirs）；绕过它的新代码路径一律拒绝合入。
- Bash 传给子进程 `process.env` 全量（现状）——secret 暴露面在 operations/52 登记，P1 收敛为最小 env + 可选透传。
- 新工具合入前必须通过 workflows/30 清单（含权限分类与 boundary 接入审查）。
