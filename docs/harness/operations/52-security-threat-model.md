# 52 安全威胁模型

> Status: normative · Owner: security reviewers · Last verified: 2026-09-05
> 变更流程：[workflows/34](../workflows/34-security-change.md)

## 资产

| 资产 | 说明 |
|---|---|
| 用户源码与文件 | 工作区内全部内容（含 boundary 外被 Bash 触达的文件） |
| 凭据 | API key（env/.env）、自定义 header、`.env` 全量 |
| transcript | 明文 prompt、工具输入输出（含可能的代码秘密） |
| 进程与网络 | 子进程权限 = 用户权限；provider 出口流量 |
| 信任边界 | 模型输出（不可信输入）→ 工具参数；transcript 文件（恢复时的输入）→ resume 校验 |

## 威胁与防线矩阵

| 威胁 | 现状防线 | 残余风险 / 计划 |
|---|---|---|
| 路径穿越（../、编码、反斜杠、sibling-prefix） | boundary 词法 containment；`--write` 侧已回归测试 | **C1**：symlink/junction 越界 → P0-C realpath 化 |
| symlink/junction/TOCTOU | 无 | P0-C；race 窗口登记为已知残余风险 |
| 危险 Bash 命令 | bashPolicy deny（全模式含 YOLO）+ allow/ask | **非 sandbox**：变体绕过可能；P2 sandbox-runtime；P1 收敛 env 透传 |
| 失控/僵尸子进程 | timeout kill shell | **B2**：无 signal 取消、无进程树 kill → P0-B |
| 资源耗尽（遍历/输出） | walk 深度/条目上限；Bash 输出截断 | **C2**：无字节/时间预算、无 cycle 防护 → P0-C；工具输出上限 P1 |
| transcript 泄漏 secrets | 无（明文落盘） | **D3**：redaction → P0-D；存储位置/权限登记 operations/53 |
| Bash 全量 env 透传 | 无 | 模型可间接读取 env 内秘密 → P1 最小 env + 显式透传清单 |
| 恶意/损坏 transcript 注入历史 | 坏行跳过、无消息拒绝 | **D1**：Read 播种信了意图 → P0-D 只信成功执行 |
| 权限绕过（后处理路径） | 工具层权限完整 | **E1**：plan+write CLI 后处理落盘 → P0-E 拒绝组合 |
| Provider 返回恶意流 | 增量合并校验薄弱 | P1 registry 校验；协议错误分类 P0-B |
| `--no-boundary` / YOLO 误用 | 显式 flag；deny 仍生效 | 文档明示信任模型；doctor 显示当前模式 |

## 信任模型声明（对外诚实表述，文档统一引用）

1. **boundary ≠ sandbox**：只约束文件工具；Bash 权限 = 用户权限。
2. **YOLO = 信任模型输出**：除 deny 列表外全部自动批准，适用于隔离/可丢弃环境。
3. **transcript 含明文会话内容**：位置 `~/.zcode/projects/<hash>/`；处理敏感项目时用 `transcript.enabled=false` 或自行清理。
4. **模型输出是不可信输入**：一切写操作经权限门 + 边界 + deny 列表。

## 事件响应

- 发现越界/泄漏：按 workflows/34 建威胁条目 → 夹具 → 修复 → 发布阻断规则复核（operations/51）。
- 凭据泄漏处理：立即轮换 key（占位符先例：`sk-REDACTED-ROTATED`）；评估 transcript 落盘内容。
