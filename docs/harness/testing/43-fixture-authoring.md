# 43 夹具编写规范（Fixture Authoring）

> Status: guide · Owner: harness maintainers · Last verified: 2026-09-05

## 原则：一次生产失败 = 一个永久回归夹具

故障复现的价值在于**固化**。发现缺陷 → 先写夹具（失败态测试）→ 修复 → 夹具转绿 → 永久保留。

## 夹具清单（新夹具按此模板登记于 PR 描述）

| 要素 | 要求 |
|---|---|
| 初态 | 最小文件集（`mkdtemp` 生成或测试内联创建）；故障条件显式可见 |
| 环境声明 | 平台假设（Windows/Git Bash 特性需注明）；不依赖外部网络/服务 |
| 触发动作 | 精确的工具调用 / CLI 参数 / 剧本序列 |
| 预期 | 可判定断言（结果形态/错误分类/退出码），禁止“不崩溃即可” |
| 终态 | 断言后的清理责任（finally 清理；夹具目录可整体删除） |

## 分类与存放

| 类型 | 存放 |
|---|---|
| 单元级故障输入 | 对应模块测试文件内 |
| 循环/协议故障剧本 | `test/harness/<topic>.test.js` + fakeLlmServer 剧本 |
| 安全回归（穿越/越界/注入） | `test/harness/boundary.test.js`、`m2Security.test.js` 或专项 `*.security.test.js` |
| 工作区级故障初态（如 UC-03） | `docs/acceptance/<uc>-workspace/` + testing/42 门判定 |

## 反模式

- 固定共享路径（并发污染）。
- 依赖真实网络/包管理器/时区/locale。
- 断言脆弱的完整输出字符串（应断言结构化字段）。
- 用 try/catch 吞掉断言失败。
- 在夹具中注释“临时绕过”而不建 issue/roadmap 条目。
