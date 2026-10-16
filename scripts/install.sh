#!/bin/bash
# 扫榜插件安装 —— macOS / Linux
# 用法：bash scripts/install.sh [profile] [spec]
#   缺省 spec = 目录直装（link:<仓库根>），要求本目录已构建出 lib/index.js；
#   Release 附件走：bash scripts/install.sh desktop /path/to/dsh-rank-scan-0.2.1.tgz
set -euo pipefail
PROFILE="${1:-desktop}"
SPEC="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "$SPEC" ]; then
  if [ ! -f "$ROOT/lib/index.js" ]; then
    echo "缺省安装=目录直装（link:$ROOT），但本目录没有构建产物：$ROOT/lib/index.js" >&2
    echo "两条路任选：" >&2
    echo "  ① 先构建再重跑本脚本：npm install && npm run build（或 pwsh -File scripts/build-local.ps1）" >&2
    echo "  ② 直接用 Release 附件：bash scripts/install.sh $PROFILE <tgz 完整路径>" >&2
    exit 1
  fi
  SPEC="link:$ROOT"
fi

# 本地 .tgz 先自检（远程 URL / github: / link: 不检查）
case "$SPEC" in
  *://*) ;;
  *.tgz) [ -f "$SPEC" ] || { echo "找不到这个 tgz 文件：$SPEC" >&2; exit 1; } ;;
esac

echo "== 扫榜插件安装 =="
echo "profile: $PROFILE"
echo "spec   : $SPEC"
command -v dsh >/dev/null 2>&1 || { echo "找不到 dsh 命令，请先安装 DeepSeek Harness。" >&2; exit 1; }
echo "⚠ 请先完全退出桌面版 DSH（否则 dsh plugin 会拒绝执行）。"
dsh plugin --profile "$PROFILE" add "$SPEC"
echo
echo "== 安装完成，怎么确认 =="
echo "本次装到 profile「$PROFILE」；若你跑的是另一个 profile，插件不会加载（表现为侧栏没有入口，不报错）。"
echo "1) 重新打开 DSH；2) 看左侧栏「扫榜」入口；3) 或 curl http://127.0.0.1:19387/api/rank-scan/health"
echo "数据目录（卸载也不会删）：~/.dsh/data/rank-scan"
