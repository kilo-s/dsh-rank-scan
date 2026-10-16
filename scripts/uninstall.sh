#!/bin/bash
# 扫榜插件卸载 —— macOS / Linux（不删数据目录）
# 用法：bash scripts/uninstall.sh [profile]
#
# 顺序固定：dsh plugin remove（失败即中止，不删 junction、不动任何文件）→ 按 package.json 的 name
# 删 junction（新名 + 旧 scope 名各试一次）→ 打印 patch 只读检查结果与数据目录。
#
# ★ 永不写入 profile 的 cordis.patch.yml（口径 Q24）：只做读 + 存在性判断 + 打印说明。
#   残留的 disabled 条目是宿主自己写的 tombstone，留着合法；宁可残留，也不冒把文件改坏的风险。
set -uo pipefail
PROFILE="${1:-desktop}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 包名以 package.json 的 name 为准（不硬编码：改名/换 scope 时脚本跟着走）
PKG="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" 2>/dev/null | head -n1)"
[ -n "$PKG" ] || PKG="dsh-rank-scan"
BASE="${PKG##*/}"
LEGACY="@dsh-external/$BASE"

if [ -z "${HOME:-}" ]; then
  echo "找不到 HOME，无法定位 profile。" >&2
  exit 2
fi
PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"
DATA_DIR="$HOME/.dsh/data/rank-scan"
PATCH="$PROFILE_DIR/cordis.patch.yml"

echo "== 扫榜插件卸载 =="
echo "profile     : $PROFILE"
echo "包名        : $PKG"
echo "profile 目录: $PROFILE_DIR"

if ! command -v dsh >/dev/null 2>&1; then
  echo "找不到 dsh 命令：无法执行 remove，因此不会删 junction、也不会动任何文件。" >&2
  echo "装好 DSH（桌面版）后重跑本脚本，或手动执行：" >&2
  echo "  dsh plugin --profile $PROFILE remove $PKG" >&2
  echo "  然后删这两个 junction（存在才删）：" >&2
  echo "    $PROFILE_DIR/node_modules/$PKG" >&2
  echo "    $PROFILE_DIR/node_modules/$LEGACY" >&2
  exit 1
fi

echo "⚠ 请先完全退出桌面版 DSH（否则 dsh plugin 会拒绝执行）。"
OUT="$(dsh plugin --profile "$PROFILE" remove "$PKG" 2>&1)"
CODE=$?
[ -n "$OUT" ] && printf '%s\n' "$OUT"
echo "dsh plugin remove 退出码：$CODE"
if [ "$CODE" -ne 0 ]; then
  echo "remove 失败（exit $CODE）：立即中止。" >&2
  echo "按口径 Q31，此时不删 junction、不改任何文件（junction 还在，插件可恢复）。" >&2
  echo "排查后手动执行：" >&2
  echo "  dsh plugin --profile $PROFILE remove $PKG" >&2
  echo "  确认成功后，再删这两个 junction（存在才删）：" >&2
  echo "    $PROFILE_DIR/node_modules/$PKG" >&2
  echo "    $PROFILE_DIR/node_modules/$LEGACY" >&2
  exit "$CODE"
fi

echo
echo "== 清理 junction =="
for LINK in "$PROFILE_DIR/node_modules/$PKG" "$PROFILE_DIR/node_modules/$LEGACY"; do
  if [ -e "$LINK" ] || [ -L "$LINK" ]; then
    if rm -rf "$LINK"; then echo "已删 junction：$LINK"; else echo "删不掉（可稍后手动删）：$LINK"; fi
  else
    echo "没有残留：$LINK"
  fi
done

echo
echo "== profile patch（只读检查，本脚本不会改动它）=="
echo "文件：$PATCH"
if [ -f "$PATCH" ]; then
  REFS="$(grep -c -F "id: $PKG" "$PATCH" 2>/dev/null || true)"
  [ -n "$REFS" ] || REFS=0
  if [ "$REFS" -gt 0 ]; then
    echo "发现 $REFS 处 id: $PKG 的记录。本脚本按 Q24 不删除它们："
    echo "  宿主在禁用插件时会写一条 tombstone（- id: <包名> / disabled: true），留着合法，下次启动不受影响。"
    echo "  想清掉请用宿主界面启用/禁用一次，或先跑 scripts/repair-patch.sh 再手工删。"
  else
    echo "没有 id: $PKG 的记录 —— patch 无需处理（本来也没有残留）。"
  fi
  echo "（本脚本不承诺 patch 零残留：宁可有残留，也不冒把文件改坏的风险。）"
else
  echo "文件不存在 —— 无需处理。"
fi

echo
echo "== 卸载完成 =="
echo "数据目录保留：$DATA_DIR（想彻底清理就自己删）"
exit 0
