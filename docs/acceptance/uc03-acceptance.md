# UC-03 验收记录 — Harness v1（M3）

> 验收定义（[harness-v1-plan.md](../plans/harness-v1-plan.md)）：
> `zcode -p "修复所有失败的测试" --yolo` 在**无人工干预**下走完 Grep → Read → Bash → Edit → Bash 循环，直到测试通过并如实汇报。

**结论：真实通过。** 运行时间 2026-08-31 01:38（本地），全程无人工干预，退出码 0。

## 环境与命令

- 运行时：Node v24.14.0，Windows 10.0.26100（Git Bash）
- Provider：DeepSeek `deepseek-v4-flash`（OpenAI 兼容方言，公开 provider 层 `src/providers/`）
- 精确命令（在验收沙盒 `docs/acceptance/uc03-workspace/` 内执行）：

```bash
node <repo>/ZCode/src/entrypoints/publicCli.js -p "修复所有失败的测试" --yolo
```

## 沙盒

`docs/acceptance/uc03-workspace/`：两个带 bug 的 JS 模块（`calc.js` 的 `add` 用了减法、`string.js` 的 `shout` 用了小写）与对应测试文件，`node --test` 初始 2 个测试文件全部失败。

## 实际执行轨迹（节选自 [uc03-run-output.log](uc03-run-output.log)）

| 轮 | 工具 | 结果 |
|---|---|---|
| 1 | `Bash(pwd && ls -la)` | ✓ 探明目录 |
| 1 | `Glob(**/*)` | ✓ 列出全部文件 |
| 1–2 | `Read(README.md / calc.js / calc.test.js / string.js / string.test.js)` | ✓ 读取源码与测试 |
| 2 | `Bash(node --test)` | ✗ 退出码 1，断言错误 `add should sum` — **如实观察失败** |
| 3 | `Edit(calc.js): "return a - b" → "return a + b"` | ✓ 精确唯一替换 |
| 3 | `Edit(string.js): "return text.toLowerCase()" → "return text.toUpperCase()"` | ✓ |
| 4 | `Bash(node --test)` | ✓ **pass 2 / fail 0** |
| 4 | 最终回答 | 如实汇报两处修复与验证输出 |

用量：18.6k input · 1.1k output · 19.7k total，6 轮（护栏上限 30 轮未触发）。

## 留档物

| 文件 | 内容 |
|---|---|
| `uc03-run-output.log` | 本次运行的完整终端输出（进度行 + 最终回答 + 工具清单） |
| `uc03-transcript.jsonl` | 会话转录（62 行 JSONL：session_start / message / tool 事件 / usage / result，mode=yolo） |
| `uc03-workspace/` | 验收沙盒（修复后的状态；`node --test` 2/2 通过） |

## 佐证要点

- 修改范围最小化：md5 对比确认仅 `calc.js`、`string.js` 两个源文件被修改，测试文件未被篡改。
- 转录 `result` 事件：`stopReason=end_turn`、`turns=6`，与终端输出一致。
- 测试通过为独立复现：沙盒内手工重跑 `node --test` 同样 2/2 通过。
