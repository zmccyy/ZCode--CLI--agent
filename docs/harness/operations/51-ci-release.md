# 51 CI 与发布

> Status: normative · Owner: release maintainers · Last verified: 2026-09-05
> Code refs: `.github/workflows/ci.yml`（Windows + Node 24，`working-directory: ZCode`）、`.github/workflows/release.yml`、`packaging/windows/`

## CI（每次 push/PR）

| 步骤 | 命令 | 门槛 |
|---|---|---|
| Install | `npm ci`（cwd=ZCode） | 锁文件一致 |
| Lint | `npm run lint` | 0 error |
| Typecheck | `npm run typecheck` | 0 error（strict） |
| Test | `npm test` | 0 fail；确定性；无网络；目标 <60s |

live e2e 不在 CI 必须路径（无 key 自动跳过）。

## 发布 Gate（tag 前全部通过，缺一即阻断）

- [ ] CI 全绿于发布 commit
- [ ] UC-03 发布门（testing/42）通过并留档
- [ ] 安全回归全绿：boundary/traversal/symlink、权限 fail-closed、deny 覆盖 YOLO、redaction
- [ ] benchmark P0 门槛（testing/44）通过
- [ ] 文档一致性：api-reference / implementation-status / README 声明与代码一致（抽查 5 项能力声明逐条对代码）
- [ ] CHANGELOG 与 tag 版本一致
- [ ] 工作树干净（现场无关变更不得混入发布 commit）

## 发布流程

```text
1. 发布分支上确认 Gate
2. ZCode/package.json 版本号更新 + CHANGELOG 条目
3. tag v*（当前最新 tag v1.3.0；v1.4.0 待 P0-E 完成后补打，见 roadmap）
4. release.yml：npm ci --omit=dev → packaging/windows/build-portable.ps1 → artifact
5. Release notes：特性 + 安全修复 + 已知限制（诚实声明非 sandbox 等）
```

## 回滚

- 发布后发现回归：回退 tag 对应 commit 的补丁（revert），不重写历史；保留失败证据（transcript/日志）。
- 修复走正常 Loop 流程；紧急修复也必须有回归测试同行。

## 诚实性规则（normative）

CHANGELOG/README/Release notes 只声明有测试或留档证据的能力。历史遗留的不实声明（v1.3 MCP 等）以本次文档校正为准绳，不允许新增同类漂移。
