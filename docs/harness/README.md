# ZCode Harness 开发文档体系

> Status: normative（入口） · Owner: harness maintainers · Last verified: 2026-09-05（v1.4.0，HEAD `3f98d76`）

本目录是 ZCode Harness 的**唯一权威开发指导**：架构、契约、开发工作流、测试与验收、安全与发布。所有历史文档（`docs/plans/`、`docs/系统设计说明书.md`、`docs/ZCode_SRS.docx`、`docs/requirements-analysis.md`）不再作为当前实现依据。

## 读者与阅读路径

| 读者 | 路径 |
|---|---|
| 新加入的核心开发者 | 00 → 01 → 02 → architecture/ → contracts/ |
| 工具 / Provider 作者 | 02 → contracts/22 或 21 → workflows/30 或 31 |
| 修改循环 / 恢复逻辑 | architecture/11、15 → workflows/32、33 → testing/40 |
| 测试与发布维护者 | testing/ → operations/51 |
| 安全审计 | operations/52 → architecture/14 → workflows/34 |

## 文档状态语义

每篇文档首行标注 Status：

- **normative**：约束实现，违反即缺陷（契约、威胁模型、验收门）。
- **guide**：推荐流程与经验（工作流、基准、运维手册）。
- **evidence**：一次实测留档（基线、验收记录），只增不改，重测另起一节。
- **historical**：仅保留背景，禁止作为当前行为依据。

## Source of truth 顺序

冲突时按以下顺序取信：

1. 代码与测试（`ZCode/src/`、`ZCode/test/`）
2. `CONTEXT.md`（术语与运行时边界）
3. 已实现 ADR（`docs/adr/`）
4. 本目录 normative 文档与 `01-current-baseline.md`
5. 验收证据（`docs/acceptance/`）
6. 历史计划 / SRS / AI 交互记录（一律 historical）

## 文档地图与依赖链

```text
00-scope-and-glossary ──► 01-current-baseline ──► 02-product-principles-and-dod
        │                                              │
        ▼                                              ▼
 architecture/10..15 ◄──────────────────────── roadmap.md（P0–P2 执行计划）
        │
        ▼
 contracts/20..24
        │
        ▼
 workflows/30..34 ──► testing/40..44 ──► operations/50..53
```

| 分区 | 内容 |
|---|---|
| `00`/`01`/`02` | 范围与术语、当前基线（含已知缺陷清单）、产品原则与完成契约 |
| `architecture/` | 运行时分层、Agent 循环、任务生命周期、Provider 方言、工具/权限/边界、transcript/compact/resume |
| `contracts/` | 消息与事件、Provider 适配、工具注册、CLI/JSON/配置、任务完成协议 |
| `workflows/` | 五类高频改动的标准开发流程（工具、Provider、循环、transcript/resume、安全） |
| `testing/` | 测试矩阵、假 LLM 与夹具规范、UC-03 发布门、夹具编写、benchmark |
| `operations/` | 开发环境、CI/发布、威胁模型、可观测性 |
| `requirements-to-capability.md` | 旧需求 → 现状映射（implemented/partial/deferred/retired） |
| `roadmap.md` | 唯一活跃开发计划（P0–P2，含 Gate 与回滚） |

## 每篇执行文档的固定元信息

```text
Status: normative | guide | evidence | historical
Owner: <角色>
Last verified: <日期 + 代码基线>
Source refs: 依赖的上游文档
Code refs: 关键源码路径（file:line 以实现为准）
Test refs: 必须通过的测试文件
DoD: 本文档所述能力的完成定义
Failure semantics: 失败时的行为约定
Security notes: 安全边界声明
```

## 变更规则

1. 修改契约（contracts/）必须同步修改引用它的 workflows 与 testing 文档，同一提交内完成。
2. `01-current-baseline.md` 的实测数据属于 evidence，更新时保留旧数据段落并注明日期。
3. 发现文档与代码冲突：**先改文档或先补测试，不允许长期共存**；连续两次release 前必须归零（见 operations/51）。
4. 历史文档不删除、只归档标注；本目录不收录任何未验证的声明。
