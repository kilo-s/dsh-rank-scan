#!/bin/bash
# 扫榜插件 patch 救援 —— macOS / Linux
# 用途：DSH 起不来、日志里说 profile 的 cordis.patch.yml 解析失败时，一条命令把 patch 修回合法顶层数组。
#
# 用法：
#   bash scripts/repair-patch.sh                    # 检查并修复（缺省 profile = desktop）
#   bash scripts/repair-patch.sh desktop -DryRun    # 只检查，不写盘
#   bash scripts/repair-patch.sh desktop -Restore   # 用本脚本最近的备份还原
#
# 做这些事：判定是否可解析（合法顶层数组）→ 不可解析则先备份再以 [] 保底回写（[] = 没有 overlay，
# 宿主一定能启动；原条目留在 .bak 里）→ 可解析则一个字节都不动 → 打印做了什么 / 怎么验证 / 怎么还原。
# 安全边界：只碰这一个文件；备份失败就不写；写用「临时文件 + mv」避免写一半。
set -uo pipefail

PROFILE="desktop"
DRY_RUN=0
RESTORE=0
ARGS_OK=1
while [ $# -gt 0 ]; do
  case "$1" in
    -DryRun|--dry-run) DRY_RUN=1; shift ;;
    -Restore|--restore) RESTORE=1; shift ;;
    -Profile|--profile) PROFILE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '3,12p' "$0"; exit 0 ;;
    -*) echo "未知参数：$1（可用：<profile> / -DryRun / -Restore）" >&2; ARGS_OK=0; shift ;;
    *) PROFILE="$1"; shift ;;
  esac
done
[ "$ARGS_OK" = "1" ] || exit 2
[ -n "$PROFILE" ] || { echo "profile 名为空。" >&2; exit 2; }

TAB="$(printf '\t')"

# 判定 patch 形态：回显 OK:<理由> / BAD:<理由>；返回 0=可解析 1=不可解析
patch_shape() {
  node "$(dirname "$0")/check-patch.mjs" "$1"
}

[ -n "${HOME:-}" ] || { echo "找不到 HOME。" >&2; exit 2; }
PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"
PATCH="$PROFILE_DIR/cordis.patch.yml"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "== 扫榜插件 patch 救援 =="
echo "profile     : $PROFILE"
echo "profile 目录: $PROFILE_DIR"
echo "patch       : $PATCH"
[ "$DRY_RUN" = "1" ] && echo "模式        : -DryRun（只检查，不写盘）"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "找不到 profile 目录 —— profile 名可能写错了。本次没有改动任何文件。" >&2
  exit 1
fi

if [ "$RESTORE" = "1" ]; then
  SRC="$(ls -1t "$PROFILE_DIR"/cordis.patch.yml.bak-rank-scan-repair-* 2>/dev/null | head -n1)"
  if [ -z "$SRC" ]; then
    echo "没找到本脚本产生的备份（cordis.patch.yml.bak-rank-scan-repair-*），无法还原。" >&2
    exit 1
  fi
  echo "用最近的备份还原：$SRC"
  if [ "$DRY_RUN" = "1" ]; then echo "-DryRun：未写盘。"; exit 0; fi
  [ -f "$PATCH" ] && cp -f "$PATCH" "$PATCH.bak-rank-scan-repair-before-restore-$STAMP"
  if cp -f "$SRC" "$PATCH"; then
    echo "已还原：$PATCH"
    echo
    echo "验证：dsh --profile $PROFILE --dump-config     （退出码 0 = 宿主能解析这个 patch）"
    exit 0
  fi
  echo "还原失败。" >&2
  exit 1
fi

if [ ! -f "$PATCH" ]; then
  echo
  echo "这个文件不存在 —— 没有 overlay，宿主照常启动，不需要修。"
  exit 0
fi

SHAPE="$(patch_shape "$PATCH")"
SHAPE_CODE=$?
if [ "$SHAPE_CODE" -gt 1 ]; then echo "无法可靠解析，停止且不写盘。" >&2; exit 2; fi
echo
echo "判定：$SHAPE"

if [ "$SHAPE_CODE" -eq 0 ]; then
  echo "文件已经是合法的顶层数组，一个字节都不动。"
  echo
  echo "验证：dsh --profile $PROFILE --dump-config     （退出码 0 = 宿主能解析）"
  exit 0
fi

BAK="$PATCH.bak-rank-scan-repair-$STAMP"
echo
echo "修复方案：先备份 → 再把 patch 回写成顶层空数组 []"
echo "  备份：$BAK"
echo "  回写：[]（空 overlay；原有条目全部留在 .bak 里，需要时用 -Restore 还原或用编辑器挑回去）"
if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "-DryRun：以上都没有做，文件未被改动。"
  exit 0
fi

if ! cp -f "$PATCH" "$BAK"; then
  echo "备份失败，未做任何修改。" >&2
  exit 1
fi
if ! printf '[]\n' > "$PATCH.repair-tmp" || ! mv -f "$PATCH.repair-tmp" "$PATCH"; then
  echo "回写失败（备份仍在：$BAK）。" >&2
  rm -f "$PATCH.repair-tmp"
  exit 1
fi

AFTER="$(patch_shape "$PATCH")"
echo
echo "== 做了什么 =="
echo "1) 备份原文件 → $BAK"
echo "2) 把 $PATCH 回写成 []"
echo "3) 回写后自检：$AFTER"
echo
echo "== 怎么验证 =="
echo "1) dsh --profile $PROFILE --dump-config   —— 退出码 0 就说明宿主能解析这个 patch 了；"
echo "2) 重新打开桌面版 DSH，看侧栏入口是否回来（路由自查：/api/rank-scan/health 返回 {ok:true}）；"
echo "3) 想撤销本次修改：bash scripts/repair-patch.sh $PROFILE -Restore"
echo
echo "如果 DSH 仍然起不来：把 -DryRun 的完整输出与 $BAK 的内容发给维护者（备份不会自动删）。"
exit 0
