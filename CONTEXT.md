# ZCode CLI Agent

终端原生 Agent 运行时项目。本文件是项目术语表——只定义语言，不记录实现细节。

## Language

**Harness（运行时骨架）**:
本项目要交付的核心物：驱动 LLM 进行多轮 Think→Act→Observe 工具循环的运行时，含工具集、权限门与会话记录。不指 TUI，也不指评测框架。
_Avoid_: 测试夹具（`test/helpers/phase2Harness.js` 的旧义）、eval framework

**Agent 循环**:
Harness 的心脏：发消息 → 流式收回复 → 执行模型请求的工具调用 → 结果回灌 → 继续，直到模型不再请求工具或触发上限。
_Avoid_: query loop、主循环

**底座树（Base Tree）**:
ZCode/src 下从 Claude Code 发布产物还原的 TS 源码（约 18.5 万行）。只作设计与行为参考，不进产品运行时，终局从仓库移除。
_Avoid_: 上游源码、Claude Code 源码

**公共层（Public Layer）**:
当前唯一可运行的运行时：publicCli 入口 + providers 适配层 + 测试套件。Harness 新代码的归宿。
_Avoid_: 壳、shell

**核心六件套**:
v1 验收所需的最小工具集：Read、Write、Edit、Bash、Glob、Grep。
_Avoid_: 全量工具集

**验收场景（UC-03）**:
v1 的完成定义：指令"修复所有失败的测试"触发 Grep → Read → Bash → Edit → Bash 循环直至通过，全程无人工干预。

**Plan 模式**:
只读权限档：Harness 可探索、可规划，但不执行任何写操作或命令。
_Avoid_: 分析模式

**Agent 模式**:
逐项审批档：每个工具调用在终端向用户请求 y/n 确认。
_Avoid_: ask 模式、default 模式

**YOLO 模式**:
自动批准档：全部工具调用直接执行，用于无人工干预的验收与 CI。
_Avoid_: auto 模式、bypass（避免与底座树内部模式名混淆）

**护栏（Guardrails）**:
循环的两条硬停线：最大轮数上限与预算上限，超限立即终止并如实汇报进度。
_Avoid_: 安全网、限制

**转录（Transcript）**:
一次会话的 JSONL 落盘记录：消息、工具调用与结果、用量与成本。
_Avoid_: 日志、history
