#!/bin/bash
# 构建：src/ → lib/
# ★ 票 31（2026-10-16）：本插件**零运行时依赖**（host 只用 node: 内建，面板只 require('react')），
#   所以这里只跑一次 tsc —— 不再 link cordis/schemastery/dsh-tools、也不再探测 .pnpm 内部布局。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TSC=""
for c in "${DSH_CHECKOUT:-}" "$HOME/dsh-harness" "$HOME/dsh" "$HOME/.dsh/dsh-harness"; do
  if [ -n "$c" ] && [ -x "$c/node_modules/.bin/tsc" ]; then TSC="$c/node_modules/.bin/tsc"; break; fi
done
if [ -z "$TSC" ]; then
  if command -v tsc >/dev/null 2>&1; then TSC="$(command -v tsc)"; else
    echo "build: 找不到 tsc（先装 typescript，或设 DSH_CHECKOUT 指向带着 tsc 的 checkout）" >&2
    exit 1
  fi
fi

"$TSC" -p tsconfig.json
echo "build: 完成 → $ROOT/lib（面板是手写 lib/client.js，不参与构建，也不会被覆盖）"
