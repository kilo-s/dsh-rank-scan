#!/bin/bash
# 扫榜插件卸载 —— macOS / Linux（不删数据目录）
# 用法：bash scripts/uninstall.sh [profile]
set -uo pipefail
PROFILE="${1:-desktop}"
PKG="dsh-rank-scan"
PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"
DATA_DIR="$HOME/.dsh/data/rank-scan"

echo "== 扫榜插件卸载 =="
if command -v dsh >/dev/null 2>&1; then
  echo "⚠ 请先完全退出桌面版 DSH。"
  dsh plugin --profile "$PROFILE" remove "$PKG" || true
else
  echo "找不到 dsh，跳过 remove（稍后手动：dsh plugin --profile $PROFILE remove $PKG）"
fi

PATCH="$PROFILE_DIR/cordis.patch.yml"
if [ -f "$PATCH" ]; then
  cp "$PATCH" "$PATCH.bak-rank-scan-uninstall"
  perl -0pi -e 's/^#+\s*已卸载插件（\Q'"$PKG"'\E）[^\n]*\n//mg; s/^\s*-\s*id:\s*dsh-rank-scan\s*\n(\s+disabled:\s*true\s*\n)?//mg' "$PATCH" || true
  echo "已清 patch 残留条目（备份：$PATCH.bak-rank-scan-uninstall）"
fi
LINK="$PROFILE_DIR/node_modules/dsh-rank-scan"
[ -e "$LINK" ] && rm -rf "$LINK" && echo "已删 junction：$LINK"
echo
echo "== 卸载完成 =="
echo "数据目录**保留**：$DATA_DIR（想彻底清理就自己删）"
