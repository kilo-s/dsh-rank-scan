# 交接：0.6.0 视觉精修整批（已完成）

- 日期：2026-10-28
- 分支：`ui/polish-0.6`（从 main v0.5.2 = 3f32906 拉出），**未合并、未打 tag**
- 范围依据：[plan-0.6.0-polish.md](plan-0.6.0-polish.md)（唯一权威）
- 版本：package.json / lock / README 已改 0.6.0；CHANGELOG 已按 A–D 分组写入

## 一句话现状

A–E 全部按方案落地，离线闸门 442 pass / 0 fail，acceptance -SkipLive 100 pass / 0 fail，截图矩阵 15 张已拍齐。等使用者决定是否合并/发版。

## 提交

| 提交 | 主题 |
|---|---|
| `1a0e5b1` | 准备：方案原文、交接骨架、书签长列表夹具脚本 `scripts/make-bm-fixture.ps1` |
| `cdc4700` | A 视觉令牌（10-tokens / 20-ui-kit / 少量降级） |
| `1f3d1e8` | B 榜单页（70-board / 55-board-cell / 25-bookmark-star） |
| `5f44c5b` | C 书签页（60-bookmarks） |
| `9792ab2` | D 概览与设置收尾对齐（40-overview / 50-settings） |
| `3fa7c6e` | E 新增 `tests/ui-polish.test.mjs` 与 `cell` 测试缝 |
| `99fd6f2` | 收尾：版本 0.6.0、CHANGELOG、README 版本号 |

## 闸门结果

| 闸门 | 结果 |
|---|---|
| `npm run build` | 每个主题提交前都跑，全绿 |
| `./scripts/test-local.ps1` | 基线 425 → **442 pass / 0 fail**（57 文件，新增 ui-polish 17 条） |
| `./scripts/acceptance.ps1 -SkipLive` | 基线 99 → **100 pass / 0 fail** |
| 公开面闸（死链 / 禁词 / 个人路径） | PASS（过程中修过一次：方案原文里提到未跟踪的过渡交接文档名，属死链，已改成不点名） |

## is-primary 清单（A6）

**保留（关键动作）**

- `40-overview.js` 扫描（联网）
- `50-settings.js` 保存设置
- `60-bookmarks.js` 详情卡「保存」（备注 + 夹）
- `60-bookmarks.js` 书签编辑「保存」

**降级为普通按钮**

- `70-board.js` 详情卡「在 DSH 侧栏浏览器打开」
- `60-bookmarks.js` 切换书签时的「继续编辑」
- `80-panel.js` 离开页签确认里的「继续编辑」

## 修改过的旧断言

**0 条。** 425 条基线测试一条没改，全部保持绿。

过程中有 4 条 Spec D 用例（`usability-ui-b.test.mjs` 的草稿保护四条）一度红：它们按 `button` 查找「＋ 备注」，而 C1 最初把它写成了 `a`。**改的是实现不是测试** —— 「＋ 备注」与备注文字都回到 `button`（ghost / 文字链接样式），草稿保护的语义与用例原样保留。

## 截图矩阵（docs/screenshots/polish-0.6/）

- 1–8：概览 / 榜单 / 书签 / 设置 × 900 亮 + 900 暗
  - docs/screenshots/polish-0.6/ov-900-light.png
  - docs/screenshots/polish-0.6/ov-900-dark.png
  - docs/screenshots/polish-0.6/board-900-light.png
  - docs/screenshots/polish-0.6/board-900-dark.png
  - docs/screenshots/polish-0.6/bm-900-light.png
  - docs/screenshots/polish-0.6/bm-900-dark.png
  - docs/screenshots/polish-0.6/pick-900-light.png
  - docs/screenshots/polish-0.6/pick-900-dark.png
- 9：榜单 480 暗色，展开一张卡 —— docs/screenshots/polish-0.6/board-480-dark-expanded.png
- 10：书签 480 亮色，含带备注 + 标签的卡 —— docs/screenshots/polish-0.6/bm-480-light-note.png
- 11：书签 900 暗色长列表，底部「已显示 50 / 120 · 再显示 50 条」 —— docs/screenshots/polish-0.6/bm-900-dark-longlist.png
- 12–15：改前 / 改后对照（改前用 v0.5.2 现拍）
  - docs/screenshots/polish-0.6/board-900-light-before.png
  - docs/screenshots/polish-0.6/board-900-light-after.png
  - docs/screenshots/polish-0.6/bm-900-light-before.png
  - docs/screenshots/polish-0.6/bm-900-light-after.png

### 拍图脚本的两条纪律（照方案执行 + 一处修正）

- 长列表与「带备注的卡」都用**浏览器内 fetch 拦截**造合成数据（`https://example.invalid/...`），**没有**向真实数据目录写任何东西。
- ★ 修正方案里的一条：暗色**不是**靠 `data-ds-dark-theme` 生效的。当前宿主把主题挂在 `data-ds-theme-source="system"` 上，手写属性不会切换配色（第一轮拍出来仍是亮色）；正确做法是 Playwright `emulateMedia({ colorScheme: 'dark' })`，或使用者自己在宿主设置里切深色。

## 实施要点（与方案的差异 / 值得记的坑）

- `C.detail` 去边框后，`70-board.js` 详情卡原本用 `boxShadow: inset 3px 0 0 accent` 模拟左色条 —— 已删掉，改由 C.detail 自带 `borderLeft`。
- `.rs-btn` 加 `height:28px; display:inline-flex` 后，书签备注的 `textarea` 需要显式 `height:auto`（已加），否则两行文本框会被压成 28px。
- `isNumCol` 的表头箭头改到文字左侧时，排序按钮加 `is-num` 类（`width:100%; justify-content:flex-end`），否则右对齐的表头点击区只覆盖文字宽度。
- 书签批分的「正在编辑的那条」用 `bmBatch(list, n, keepKey)` 的第三参处理：超出已渲染范围时追加渲染，不改变总数与「再显示」语义。
- 夹具脚本 `scripts/make-bm-fixture.ps1` 仍在仓库里（默认 120 条、只写 `${OutDir}/state/bookmarks.json`），后续手工验收长列表可直接用。

## 发布后必须人工确认的一条（暗色）

> ★ 截图里的暗色是 Playwright `emulateMedia({ colorScheme: 'dark' })` 模拟出来的，**没有经过宿主真实的主题切换**。
> 发布后在真实 DSH 里手动切到暗色，把概览 / 榜单 / 书签 / 设置各看一次（重点：链接下划线、卡片边界、星标出现时机、数字列对齐、C.detail 左侧色条），确认无异常再对外宣布本版样式定稿。

## 下一步（等使用者决定，我不自行推进）

1. 是否需要合并 `ui/polish-0.6` → main 并打 `v0.6.0`（本会话按纪律**没有**合并、没有打 tag、没有推送）。
2. 合并后由使用者在本地跑 `dsh plugin add github:kilo-s/dsh-rank-scan#v0.6.0` 做真实安装验证。
3. 若截图要贴到公开面，需先推分支（现在 raw 链接还取不到）。
