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

# 面板 bundle 的源在 client/client.js（手写，不经 tsc）。构建的职责是把它**复制**到产物目录，
# 这样从仓库 clone 出来就能构建出与发布包一致的 lib/client.js。
[ -f "$ROOT/client/client.js" ] || { echo "build: 缺 client/client.js（面板源）" >&2; exit 1; }
mkdir -p "$ROOT/lib"
cp "$ROOT/client/client.js" "$ROOT/lib/client.js"
echo "build: 完成 → $ROOT/lib（host 由 tsc 产出；面板 bundle 由 client/client.js 复制而来）"
