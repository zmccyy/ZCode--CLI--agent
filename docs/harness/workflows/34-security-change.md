# 34 工作流：安全相关变更

> Status: normative · Owner: security reviewers · Last verified: 2026-09-05
> 前置阅读：[operations/52](../operations/52-security-threat-model.md)

## 触发范围（命中任一即按本流程）

- 路径解析 / boundary / 文件工具 I/O
- Bash 策略、子进程创建、进程终止、环境变量传递
- 网络（provider 之外的新出口）、MCP/外部工具接入
- transcript 持久化、redaction、日志输出
- 权限模式、审批流、deny/allow 列表

## 流程

```text
1. 威胁建模    在 operations/52 对应威胁条目下登记：攻击面、前提、影响
2. 失败封闭    确认失败路径 fail-closed（拒绝服务好过意外放行）
3. 实现        最小改动；不引入新运行时依赖（零依赖红线）
4. 回归资产    每个修复 = 一个永久回归测试（testing/43 的转化规则）
5. 审查        安全 Owner 批准；权限放宽另需 architecture/14 红线确认
6. 深度扫描    合入前跑 Mimosa 深度安全扫描（mimosa-security-scan，deep）
```

## 已知遗留（随 P0 关闭）

| 缺陷 | 威胁 | Loop |
|---|---|---|
| C1 symlink/junction 词法边界 | 越界读/写 | P0-C |
| C2 walk 无预算/无 cycle 防护 | 资源耗尽 | P0-C |
| B2 Bash 无取消/无进程树 kill | 僵尸进程/失控命令 | P0-B |
| D3 transcript 明文 secrets | 凭据泄漏 | P0-D |
| E1 plan+write 绕过 | Plan 零写入承诺破坏 | P0-E |
| Bash 全量 env 透传 | secret 暴露面 | P1 |

## 发布阻断条件（normative）

- boundary/symlink/穿越回归任一失败 → 阻断
- 权限 fail-closed 或 deny 覆盖 YOLO 语义被破坏 → 阻断
- secrets 落盘回归失败 → 阻断
- 新增外部副作用入口（网络/进程/MCP）无威胁模型条目 → 阻断

## DoD

- [ ] 威胁模型条目新增/更新
- [ ] fail-closed 论证写入 PR 描述
- [ ] 永久回归测试存在且绿
- [ ] Mimosa 深度扫描无新增高危
