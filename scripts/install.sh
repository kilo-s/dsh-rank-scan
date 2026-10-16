#!/bin/bash
# 扫榜插件安装 —— macOS / Linux
# 用法：bash scripts/install.sh [profile] [spec]
set -euo pipefail
PROFILE="${1:-desktop}"
SPEC="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -z "$SPEC" ] && SPEC="link:$ROOT"

echo "== 扫榜插件安装 =="
echo "profile: $PROFILE"
echo "spec   : $SPEC"
command -v dsh >/dev/null 2>&1 || { echo "找不到 dsh 命令，请先安装 DeepSeek Harness。" >&2; exit 1; }
echo "⚠ 请先完全退出桌面版 DSH（否则 dsh plugin 会拒绝执行）。"
dsh plugin --profile "$PROFILE" add "$SPEC"
echo
echo "== 安装完成，怎么确认 =="
echo "1) 重新打开 DSH；2) 看左侧栏「扫榜」入口；3) 或 curl http://127.0.0.1:19387/api/rank-scan/health"
echo "数据目录（卸载也不会删）：~/.dsh/data/rank-scan"
