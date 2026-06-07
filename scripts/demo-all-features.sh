#!/usr/bin/env bash
# =============================================================================
# ZCode CLI Agent — 全功能展示脚本
# =============================================================================
# 用法：
#   bash scripts/demo-all-features.sh              # 自动执行所有离线功能
#   bash scripts/demo-all-features.sh --live       # 包含需要 API 的实时演示
#   bash scripts/demo-all-features.sh --help       # 查看所有演示模式
#
# 环境要求：
#   - Node.js >= 22 或 Bun >= 1.0
#   - Git Bash (Windows) / bash (Linux/macOS)
#   - --live 模式需要配置 ZCODE_PROVIDER 和 API Key
# =============================================================================

set -o pipefail

# ---- 配置 ---------------------------------------------------------------
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_CLI="node $ROOT/ZCode/src/entrypoints/publicCli.js"
TMP_DIR="$ROOT/tmp/demo-$(date +%Y%m%d-%H%M%S)"
PASS=0
FAIL=0
SKIP=0

# 颜色 (Windows Terminal / modern terminals 支持)
BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RED="\033[31m"
DIM="\033[2m"
RESET="\033[0m"

# ---- 工具函数 -----------------------------------------------------------
header() {
  echo ""
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}${CYAN}  $1${RESET}"
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════════${RESET}"
  echo ""
}

section() {
  echo ""
  echo -e "${BOLD}── $1 ──${RESET}"
  echo ""
}

info() {
  echo -e "${DIM}  $*${RESET}"
}

check() {
  local desc="$1" expected="$2"
  local output
  output=$($PUBLIC_CLI "$desc" 2>&1) && local ok=$? || ok=$?
  if echo "$output" | grep -q -e "$expected"; then
    echo -e "  ${GREEN}✓${RESET} $desc"
    ((PASS++))
  else
    echo -e "  ${RED}✗${RESET} $desc"
    echo -e "    ${DIM}Expected to match: $expected${RESET}"
    ((FAIL++))
  fi
}

check_exact() {
  local cmd="$1" expected="$2" desc="$3"
  local output
  output=$(eval "$cmd" 2>&1) && local ok=$? || ok=$?
  if echo "$output" | grep -q -e "$expected"; then
    echo -e "  ${GREEN}✓${RESET} $desc"
    ((PASS++))
  else
    echo -e "  ${RED}✗${RESET} $desc"
    echo -e "    ${DIM}Command: $cmd${RESET}"
    echo -e "    ${DIM}Expected to match: $expected${RESET}"
    echo -e "    ${DIM}Got: $(echo "$output" | head -3)${RESET}"
    ((FAIL++))
  fi
}

run_live() {
  local cmd="$1" desc="$2"
  echo -e "${BOLD}  ▶ $desc${RESET}"
  echo -e "${DIM}  \$ $cmd${RESET}"
  echo ""
  eval "$cmd" 2>&1
  local ok=$?
  echo ""
  if [ $ok -eq 0 ]; then
    echo -e "  ${GREEN}✓${RESET} Completed (exit 0)"
    ((PASS++))
  else
    echo -e "  ${YELLOW}⚠${RESET} Completed (exit $ok)"
    ((SKIP++))
  fi
}

summary() {
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  Results: ${GREEN}$PASS passed${RESET}  ${RED}$FAIL failed${RESET}  ${YELLOW}$SKIP skipped${RESET}${RESET}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════${RESET}"
}

# ---- 解析参数 -----------------------------------------------------------
LIVE_MODE=false
INTERACTIVE_MODE=false
while [ $# -gt 0 ]; do
  case "$1" in
    --live) LIVE_MODE=true ;;
    --interactive|-i) INTERACTIVE_MODE=true ;;
    --help|-h)
      echo "ZCode 全功能展示脚本"
      echo ""
      echo "用法: bash $0 [选项]"
      echo ""
      echo "选项:"
      echo "  --live          包含需要 API Key 的实时演示"
      echo "  --interactive   包含交互式 REPL 演示"
      echo "  --help          显示此帮助"
      exit 0
      ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
  shift
done

mkdir -p "$TMP_DIR"

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  PART 1 — 离线功能 (无需 API Key)                                       ║
# ╚══════════════════════════════════════════════════════════════════════════╝

header "PART 1 — 离线功能 (Offline Features)"

# 1.1 ── 版本信息 ────────────────────────────────────────────────────────
section "1.1 版本信息"
  check_exact "$PUBLIC_CLI --version" "ZCode" "zcode --version 显示版本标识"
  check_exact "$PUBLIC_CLI -v" "ZCode" "zcode -v 短选项等价"

# 1.2 ── 帮助系统 ────────────────────────────────────────────────────────
section "1.2 帮助系统"
  check_exact "$PUBLIC_CLI --help" "Usage" "--help 显示完整用法"
  check_exact "$PUBLIC_CLI --help" "doctor" "--help 包含所有子命令"
  check_exact "$PUBLIC_CLI --help" "--write" "--help 包含 --write 选项"
  check_exact "$PUBLIC_CLI --help" "--plan" "--help 包含 --plan 选项"
  check_exact "$PUBLIC_CLI --help" "--reasoning" "--help 包含 --reasoning 选项"
  check_exact "$PUBLIC_CLI help" "Usage" "help 子命令等价于 --help"

# 1.3 ── 环境诊断 ────────────────────────────────────────────────────────
section "1.3 环境诊断 (doctor)"
  echo -e "${BOLD}  ▶ doctor (文本模式)${RESET}"
  $PUBLIC_CLI doctor 2>&1
  echo ""
  echo -e "${BOLD}  ▶ doctor --json (JSON 模式)${RESET}"
  $PUBLIC_CLI doctor --json 2>&1 | head -20
  echo ""

  check_exact "$PUBLIC_CLI doctor" "print ready" "doctor 显示 print readiness"
  check_exact "$PUBLIC_CLI doctor --json" '"productName"' "doctor --json 输出结构化 JSON"
  check_exact "$PUBLIC_CLI doctor --json" '"provider"' "doctor --json 包含 provider 信息"
  check_exact "$PUBLIC_CLI doctor --json" '"runtime"' "doctor --json 包含 runtime 信息"

# 1.4 ── 模型列表 ────────────────────────────────────────────────────────
section "1.4 模型列表 (models)"
  echo -e "${BOLD}  ▶ models (文本模式)${RESET}"
  $PUBLIC_CLI models 2>&1
  echo ""
  echo -e "${BOLD}  ▶ models --json (JSON 模式)${RESET}"
  MODELS_JSON=$($PUBLIC_CLI models --json 2>&1)
  echo "$MODELS_JSON" | head -20
  echo ""

  check_exact "$PUBLIC_CLI models" "deepseek" "models 列出可用模型"
  check_exact "$PUBLIC_CLI models --json" '"id"' "models --json 包含 model id"

# 1.5 ── Plan 模式 ───────────────────────────────────────────────────────
section "1.5 Plan 模式"
  echo -e "${BOLD}  ▶ --plan -p (只分析不执行)${RESET}"
  $PUBLIC_CLI --plan -p "write a function to sort an array" 2>&1
  echo ""
  check_exact "$PUBLIC_CLI --plan -p 'hello'" "PLAN MODE" "plan 模式显示 PLAN MODE 标识"
  check_exact "$PUBLIC_CLI --plan -p 'hello'" "Remove --plan to execute" "plan 模式提示如何执行"

# 1.6 ── YOLO 模式 ───────────────────────────────────────────────────────
section "1.6 YOLO 模式"
  check_exact "$PUBLIC_CLI --yolo --help" "YOLO" "--yolo 选项被解析"

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  PART 2 — 实时功能 (需要 API Key)                                       ║
# ╚══════════════════════════════════════════════════════════════════════════╝

header "PART 2 — 实时功能 (Live Features)"

if [ "$LIVE_MODE" != "true" ]; then
  echo -e "${YELLOW}  ⚠ 跳过实时演示。使用 --live 标志启用。${RESET}"
  echo -e "${DIM}  需要配置: ZCODE_PROVIDER=openai-compatible 和 ZCODE_OPENAI_* 环境变量${RESET}"
  echo ""
  ((SKIP+=8))
else
  # 2.1 ── 基础 Print 模式 ───────────────────────────────────────────────
  section "2.1 基础 Print 模式"
    run_live "$PUBLIC_CLI -p 'Say hello in exactly 3 words'" \
      "print 模式：基础文本生成"

  # 2.2 ── Print 模式 + JSON ─────────────────────────────────────────────
  section "2.2 Print 模式 + JSON 输出"
    run_live "$PUBLIC_CLI -p 'What is 1+1? Answer briefly.' --json" \
      "print --json：结构化 JSON 输出 (含 usage 统计)"

  # 2.3 ── Print 模式 + 推理展示 ─────────────────────────────────────────
  section "2.3 Print 模式 + 推理展示"
    run_live "$PUBLIC_CLI -p 'Explain the difference between var and let in JavaScript' --reasoning" \
      "print --reasoning：展示模型推理/思考过程"

  # 2.4 ── Print 模式 + 代码写入 ─────────────────────────────────────────
  section "2.4 Print 模式 + 代码写入"
    run_live "$PUBLIC_CLI -p 'Write a Python script that prints the first 10 Fibonacci numbers' --write $TMP_DIR/fib.py" \
      "print --write fib.py：生成代码并写入指定文件"

    if [ -f "$TMP_DIR/fib.py" ]; then
      echo -e "${BOLD}  ▶ 验证写入的文件内容:${RESET}"
      head -15 "$TMP_DIR/fib.py"
      echo ""
    fi

  # 2.5 ── Print 模式 + 多文件写入 ───────────────────────────────────────
  section "2.5 Print 模式 + 多文件自动写入"
    run_live "$PUBLIC_CLI -p 'Create a simple index.html with inline CSS and JavaScript that displays Hello World' --write" \
      "print --write：自动识别代码块并写入独立文件"

    echo -e "${BOLD}  ▶ 生成的文件列表:${RESET}"
    ls -la "$TMP_DIR/"
    echo ""

  # 2.6 ── Print 模式 + 指定模型 ─────────────────────────────────────────
  section "2.6 Print 模式 + 指定模型"
    run_live "$PUBLIC_CLI -p 'Say good morning in one sentence' -m deepseek-chat" \
      "print -m <model>：指定特定模型"

  # 2.7 ── Print 模式 + 代码生成 demo ────────────────────────────────────
  section "2.7 综合 Demo：生成完整脚本"
    run_live "$PUBLIC_CLI -p 'Write a bash script that prints system info (OS, CPU count, memory, disk usage). Output ONLY the script in a code block.' --write $TMP_DIR/sysinfo.sh" \
      "综合：生成系统信息脚本"
fi

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  PART 3 — 交互式 REPL (需要 Bun)                                        ║
# ╚══════════════════════════════════════════════════════════════════════════╝

header "PART 3 — 交互式 REPL"

BUN_AVAILABLE=false
if command -v bun &> /dev/null; then
  BUN_VERSION=$(bun --version 2>&1)
  echo -e "  ${GREEN}✓${RESET} Bun 已安装: $BUN_VERSION"
  BUN_AVAILABLE=true
else
  echo -e "  ${YELLOW}⚠${RESET} Bun 未安装 — REPL 功能需要 Bun"
  echo -e "  ${DIM}安装: npm install -g bun${RESET}"
  ((SKIP+=3))
fi

if [ "$BUN_AVAILABLE" = "true" ] && [ "$INTERACTIVE_MODE" = "true" ]; then
  section "3.1 交互式 REPL 启动"
    echo -e "${BOLD}  启动命令: bun src/entrypoints/cli.tsx${RESET}"
    echo -e "${DIM}  输入你的问题，ZCode 将在终端中实时回复${RESET}"
    echo -e "${DIM}  支持: 文件读写、代码搜索、Shell 执行、Git 操作${RESET}"
    echo -e "${DIM}  快捷键: Ctrl+C 中断 | Ctrl+O 展开 | Ctrl+E 切换 transcript${RESET}"
    echo ""
    echo -e "${YELLOW}  请手动运行: cd $ROOT/ZCode && bun src/entrypoints/cli.tsx${RESET}"

elif [ "$BUN_AVAILABLE" = "true" ]; then
  section "3.1 交互式 REPL (已跳过)"
    echo -e "${DIM}  使用 --interactive 标志进入交互式演示${RESET}"
    echo -e "${DIM}  或手动运行: cd $ROOT/ZCode && bun src/entrypoints/cli.tsx${RESET}"
    ((SKIP++))

  section "3.2 Bun REPL 入口验证"
    check_exact "cd $ROOT/ZCode && bun src/entrypoints/cli.tsx --help 2>&1" "Usage" \
      "bun cli.tsx --help 可正常启动"
    check_exact "cd $ROOT/ZCode && bun src/entrypoints/cli.tsx --version 2>&1" "ZCode\|claude\|0\." \
      "bun cli.tsx --version 显示版本"
fi

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  PART 4 — Provider 系统展示                                             ║
# ╚══════════════════════════════════════════════════════════════════════════╝

header "PART 4 — Provider 系统"

section "4.1 当前 Provider 诊断"
  $PUBLIC_CLI doctor 2>&1 | grep -E "provider|model|print|cwd|runtime" || true
  echo ""

section "4.2 多 Provider 支持说明"
  echo -e "${DIM}  ZCode 支持以下 Provider:${RESET}"
  echo -e "${DIM}    • anthropic        — Anthropic Messages API (Claude Opus/Sonnet/Haiku)${RESET}"
  echo -e "${DIM}    • openai-compatible — DeepSeek, OpenAI, 及其他兼容 API${RESET}"
  echo -e "${DIM}    • aws-bedrock      — AWS Bedrock Runtime (Claude)${RESET}"
  echo -e "${DIM}    • google-vertex    — Google Vertex AI${RESET}"
  echo -e "${DIM}    • azure-foundry    — Azure AI Foundry${RESET}"
  echo ""
  echo -e "${DIM}  切换 Provider:${RESET}"
  echo -e "${DIM}    export ZCODE_PROVIDER=openai-compatible${RESET}"
  echo -e "${DIM}    export ZCODE_OPENAI_BASE_URL=https://api.deepseek.com${RESET}"
  echo -e "${DIM}    export ZCODE_OPENAI_API_KEY=sk-xxx${RESET}"
  echo -e "${DIM}    export ZCODE_OPENAI_MODEL=deepseek-chat${RESET}"
  echo ""

section "4.3 双线路 Model Registry"
  check_exact "$PUBLIC_CLI models" "deepseek" "models 列出 OpenAI-compatible 线路模型"
  check_exact "$PUBLIC_CLI models --json" '"provider"' "models --json 标注每个模型的 provider"

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  PART 5 — 功能对照表                                                    ║
# ╚══════════════════════════════════════════════════════════════════════════╝

header "PART 5 — 功能对照表"

cat <<'EOF'

  ┌─────────────────────────────────────────────────────┬──────────┐
  │  功能                                 支持情况       │  状态     │
  ├─────────────────────────────────────────────────────┼──────────┤
  │  help / --help                       完整帮助系统   │  ✅       │
  │  doctor                              环境诊断       │  ✅       │
  │  doctor --json                       JSON 诊断     │  ✅       │
  │  models                              模型列表       │  ✅       │
  │  models --json                       JSON 模型列表 │  ✅       │
  │  -p / --print <prompt>               非交互式查询   │  ✅       │
  │  -p --json                           JSON 输出     │  ✅       │
  │  -p --reasoning                      推理过程展示   │  ✅ NEW   │
  │  -p --write <path>                   代码写入文件   │  ✅ NEW   │
  │  -p --write                          多文件写入     │  ✅ NEW   │
  │  -m / --model <id>                   指定模型       │  ✅       │
  │  --plan                              只读计划模式   │  ✅ NEW   │
  │  --yolo                              自动批准模式   │  🚧 CLI   │
  │  交互式 REPL (Bun)                   完整 Agent 模式 │  🚧       │
  │  MCP 协议支持                        Model Context │  ✅       │
  │  多 Provider (5 种)                  后端切换       │  ✅       │
  │  文件读取/编辑/写入                  代码操作       │  ✅       │
  │  Shell/Bash/PowerShell               命令执行       │  ✅       │
  │  Git 操作                            版本控制       │  ✅       │
  │  Web 搜索/获取                       网络访问       │  ✅       │
  │  LSP 诊断                            代码检查       │  ✅       │
  │  会话管理 (JSONL)                    持久化         │  ✅       │
  │  Hooks 系统 (27 事件)                自动化         │  ✅       │
  │  Plan Mode (Agent)                   交互式计划     │  ✅       │
  │  Auto-Compact                        上下文压缩     │  ✅       │
  │  Permissions (Windows 适配)          安全控制       │  ✅       │
  │  Subagent / Swarm                    并行代理       │  ✅       │
  │  Skills / Plugins                    可扩展性       │  ✅       │
  └─────────────────────────────────────┴──────────────┘

EOF

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  PART 6 — 快速开始指南                                                   ║
# ╚══════════════════════════════════════════════════════════════════════════╝

header "PART 6 — 快速开始指南"

cat <<EOF

  ${BOLD}1. 配置 Provider${RESET}
     ${DIM}cp .env.example .env${RESET}
     ${DIM}编辑 .env 填入你的 API Key${RESET}

  ${BOLD}2. 验证环境${RESET}
     ${DIM}zcode doctor${RESET}

  ${BOLD}3. 查看模型${RESET}
     ${DIM}zcode models${RESET}

  ${BOLD}4. 单次查询${RESET}
     ${DIM}zcode -p "explain this codebase"${RESET}

  ${BOLD}5. 代码生成 + 写入文件${RESET}
     ${DIM}zcode -p "write a React login form" --write${RESET}

  ${BOLD}6. 带推理过程${RESET}
     ${DIM}zcode -p "explain closures" --reasoning${RESET}

  ${BOLD}7. 交互式 REPL (需要 Bun)${RESET}
     ${DIM}cd ZCode && bun src/entrypoints/cli.tsx${RESET}

  ${BOLD}8. Plan 模式 (建议不执行)${RESET}
     ${DIM}zcode --plan -p "migrate the database schema"${RESET}

EOF

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  清理 & 总结                                                             ║
# ╚══════════════════════════════════════════════════════════════════════════╝

section "演示文件"
  echo -e "${DIM}  生成的文件位于: $TMP_DIR${RESET}"
  echo -e "${DIM}  清理: rm -rf $TMP_DIR${RESET}"

summary

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo -e "${RED}  ⚠ 有 $FAIL 项检查失败，请检查环境配置${RESET}"
  exit 1
fi

echo ""
echo -e "${GREEN}  演示完成！${RESET}"
exit 0
