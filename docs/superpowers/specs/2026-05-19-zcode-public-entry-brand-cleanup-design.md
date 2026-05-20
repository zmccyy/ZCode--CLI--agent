# ZCode 公共入口品牌残留清理设计

## 文档类型

Explanation + design spec

## 背景

当前 `ZCode` 已经完成了第一轮品牌配置抽离，但用户首次打开主界面时，仍然会直接看到多处上游品牌残留，主要集中在欢迎区、帮助区、远程控制首层提示、更新提示以及部分首层弹窗文案。

这些内容的问题不只是“名字没换干净”，而是主界面的表达重心仍偏向“上游产品欢迎页”，而不是一个终端工具应有的“操作入口”。

本次改造目标是把这些公共入口的用户可见表层统一收敛成 `ZCode` 视角，并让主界面气质更接近 `deepseek-TUI`、`iflow` 这类 CLI 工具的操作台风格。

## 目标

本次只处理“用户一打开就能看到”或“首次使用时很容易立刻弹出”的界面与文案：

- 欢迎区 / 主 REPL 首屏入口
- Help 中的 General 说明
- 权限类弹窗的首层标题与副文案风格
- Remote Control / 远程访问的首层提示与状态文案
- update 命令的用户可见提示

目标不是做一次全面品牌替换，而是完成一次明确边界内的公共入口收口。

## 非目标

以下内容明确不在本次范围内：

- 命令名、包名、环境变量名
- 内部兼容层中的 `Claude` / `Anthropic` 命名
- provider、auth、bridge、MCP、session 等底层逻辑
- 非首层、非首次可见的历史兼容文案
- 测试中用于兼容说明的内部表述
- 大规模状态流或布局系统重写

## 设计方向

本次采用 `Operator Console` 方向。

核心判断：

- 主界面不再强调“欢迎来到某个品牌产品”
- 主界面要优先回答“我现在在哪、能做什么、怎么开始”
- 风格参考终端工具，而不是产品宣传页

对应原则：

- 信息密度高于装饰密度
- 状态与动作优先于品牌露出
- 短句、低噪声、强 CLI 感

## 设计方案

### 1. 主界面入口

欢迎区从“品牌展示块”改成“操作台头部”。

#### 结构

首屏头部采用三层结构：

1. 产品与版本
2. 当前上下文
3. 动作提示

建议内容形态：

```text
ZCode · vX.Y.Z
cwd: <workspace> · mode: interactive
ask, edit, run, inspect
```

#### 视觉要求

- 去掉明显指向上游产品的欢迎语
- 去掉大块 mascot / 吉祥物式视觉中心
- 允许保留少量 ASCII 或分隔线来维持终端识别度
- 版式应更窄、更稳、更像操作台

#### 用户感知目标

用户打开后第一眼看到的是：

- 当前产品身份：`ZCode`
- 当前会话状态
- 可以立即开始的动作

而不是：

- 上游产品名
- 品牌欢迎语
- 与实际操作无关的大面积视觉装饰

### 2. Help / General 文案

`General` 区域改成中性、工具化的能力描述。

#### 文案原则

- 不再使用 `Claude understands...` 这类上游产品叙述
- 用工具行为描述替代品牌人格化描述
- 句子尽量短，直接陈述能力

#### 目标表达

文案应类似：

`ZCode reads your workspace, proposes edits, runs commands with approval, and keeps the session in context.`

如果考虑终端宽度，可进一步压缩，但保持以下语义：

- 读取工作区
- 提议或执行修改
- 在授权下运行命令
- 保持会话上下文

### 3. 权限与首层弹窗文案

权限弹窗不做品牌宣传，只做动作说明。

#### 原则

- 标题继续使用动作导向表达
- 副文案解释“要执行什么、为什么需要、你如何决定”
- 避免在首层文案中额外暴露上游品牌名

#### 风格

- 使用中性语气
- 避免营销或拟人语气
- 避免“欢迎”“智能”“助手”类弱信息词

### 4. Remote Control 首层提示

Remote Control 作为功能名本次可以保留，但首层文案去掉明显的上游产品露出。

#### 调整目标

把这类描述：

- `Claude app`
- `claude.ai/code`
- `access this CLI session from the web ... on any device`

替换为更中性的功能表述，例如：

- `open this session elsewhere`
- `connect this terminal session to the web`
- `resume this session from another device`

#### 边界

以下不动：

- 底层命令名
- 实际链接生成逻辑
- 真实 URL
- 底层连接与鉴权实现

本次只替换用户第一眼看到的说明文案、对话框标题和状态句子。

### 5. 更新提示

update 相关文案从 `Claude` / `Claude Code` 收敛到 `ZCode` 或中性 build 文案。

#### 示例方向

- `ZCode is up to date`
- `Already on the latest build`
- `Successfully updated from <old> to <new>`

#### 原则

- 保持现有信息结构
- 只替换对用户可见的品牌文本
- 不改安装方式判断和更新机制

## 涉及入口点

本次重点覆盖下列入口点：

- `ZCode/src/components/LogoV2/WelcomeV2.tsx`
- `ZCode/src/components/HelpV2/General.tsx`
- `ZCode/src/components/RemoteCallout.tsx`
- `ZCode/src/components/BridgeDialog.tsx`
- `ZCode/src/bridge/bridgeStatusUtil.ts`
- `ZCode/src/cli/update.ts`

视实现情况，可能补充少量直接承接这些入口组件的调用点，但不扩大到内部兼容层。

## 实施策略

采用“小范围表层重排 + 文案收敛”的方式实施。

### 要做的事

- 替换欢迎区标题与布局
- 收缩或移除首屏中明显的上游视觉符号
- 统一 Help / General 文案
- 统一 Remote Control 首层说明
- 统一 update 用户提示

### 不做的事

- 重写 REPL 状态流
- 改造底层 bridge 协议
- 重构 brand config 体系
- 对全仓做一轮字符串全替换

## 风险

### 风险 1：欢迎区布局与旧视觉耦合较深

当前欢迎组件包含较重的既有视觉内容。改造时需要避免窄终端下的换行错位和信息抖动。

缓解策略：

- 尽量使用固定的短行结构
- 先保留简单分隔，而不是引入复杂 ASCII 图形
- 以 80 列左右终端为基准控制宽度

### 风险 2：Remote Control 文案与真实链接说明混在一起

Remote Control 相关界面里，一部分文案同时承担“功能解释”和“链接暴露”职责。

缓解策略：

- 只替换首层解释文本
- 保留真实链接、命令和连接路径
- 不改底层连接状态与 URL 生成逻辑

### 风险 3：update 提示与包管理器提示混写

update 文案里既有品牌提示，也有平台级安装说明。

缓解策略：

- 只替换品牌句子
- 不改包管理器命令本身
- 保持诊断与更新分支逻辑不变

## 验收标准

满足以下条件即可认为本次完成：

1. 首次进入 REPL 时，不再出现 `Welcome to Claude Code` 这类主文案。
2. 首屏欢迎区的视觉重心从品牌展示改为操作入口。
3. `Help / General` 不再用 `Claude` 作为主语。
4. Remote Control 首层提示不再直接把 `Claude app` / `claude.ai/code` 作为核心说明文案。
5. update 用户提示不再显示 `Claude is up to date` 或 `Claude Code is up to date`。
6. 不影响现有输入、授权、状态显示和继续会话的基本流程。

## 结论

这次改造不是一次泛化的品牌全替换，而是一轮严格限定在“公共入口可见表层”的界面收口。

正确结果应该是：

- 用户打开 `ZCode` 时，看到的是一个终端操作台
- 首层文案统一、克制、工具化
- 上游品牌残留不再主导用户的第一印象

在这份设计通过后，再进入实现阶段。
