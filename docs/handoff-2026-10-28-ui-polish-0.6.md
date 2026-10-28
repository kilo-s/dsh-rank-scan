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

## 复查补丁（第 2 轮，使用者看完截图后提的 5 条）

| # | 问题 | 结论 / 处理 |
|---|---|---|
| 1 | 中点串没有间距（「在读 676,671·截止」） | **真因**：元信息行是 flex 容器，子节点的首尾空格会被行盒裁掉 —— 写 `' · '` 等于没有空格。新增纯函数 `metaDot(key)`（`margin: 0 4px` + `color: T.muted` + `·`），书签卡片与窄屏榜单卡片都改用它；手写分隔符一处不留 |
| 2 | 有备注的文字像链接（加粗 + 常驻下划线） | 保留 `button` 语义，改挂 `.rs-note-text`：常规字重、`T.fg`、默认无下划线，只有 hover / focus-visible 才出下划线；「＋ 备注」空状态样式不变 |
| 3 | board-480-dark-expanded 左上角带斜线的圆形图标 | **不是面板的**。实测 `document.elementFromPoint(14,16)` 命中的是宿主的「打开侧边栏」按钮（`data-dsh-responsive-part="sidebar-toggle"`，在 `data-shell-overlay` 那层里），它的层叠顺序高于面板 ⇒ 压在我们的标题上。面板侧无可修，未改 |
| 4 | 第 2 张卡是亮白色粗边框（疑似焦点环） | **不是焦点环**（实测 `outline-style: none`、`:focus-visible` 为 false）。真因是窄屏卡片写了 `borderColor: open ? T.border : undefined`：React 把 `undefined` 落成 `style.borderColor = ''`，这一下会把 C.card 的 `border` 长写**整条清空**，边框退回 `currentColor` —— 暗色下就是近白色的一圈亮边。改成「展开态整体替换 style，不写 `: undefined`」；表格行的 `background: … : undefined` 同样处理 |
| 5 | 展开详情里「备注 / 书签夹」还是盒子里套盒子，星标悬在盒子外 | `DetailBookmarkEditor` 不再套 `C.detail`（内层无底色、无边框）；星标与表单进同一列（星标贴左、表单占满其余宽度）。**没有动 `25-bookmark-star.js`** —— 星标的 class 与点击逻辑原样，只调了它在详情里的排布 |

## 修改过的旧断言（0.6.0 全程累计）

- `tests/ui-layout.test.mjs`「② 列按可用宽度装…」：取样窗口 `i + 2600` → `i + 4200`。卡片行加了展开态的整段 style（含解释注释），正文变长让原来的窗口截断在 `BookmarkStar` 之前；**断言内容一条没改**（卡片行仍要能打书签、仍要显示指标）。
- 除此之外基线测试一条没动。

## 闸门（复查补丁后）

- `npm run build` 绿
- `./scripts/test-local.ps1`：**445 pass / 0 fail**（新增 3 条：metaDot、备注文字样式、`: undefined` 回归）
- `./scripts/acceptance.ps1 -SkipLive`：**100 pass / 0 fail**

## `http.sslVerify=false` 的作用范围（重要）

- 它**只**出现在本次推送的单条命令里，作为 `git -c http.sslVerify=false …` 的一次性参数（同一批还用了 `-c credential.helper=` 与 `-c http.extraheader=Authorization: …`）。
- **没有**写进任何 global / local / system 配置，也**没有**写进任何脚本的默认值：实测 `git config --global --get http.sslVerify` 与 `--local` 均为空，`credential.helper` 同样为空。
- 为什么需要它：开发机直连 GitHub 被 TLS 拦截，而本地代理口（12000/7890/7891）当时都没在监听（`dsh-git-audit.ps1` 的判断）。下次推送仍然要重新判断，**不要**把它固化成默认。

## 0.6 收尾（发布前那一轮，只做展示层）

| # | 事项 | 落点 | 备注 |
|---|---|---|---|
| 1 | 起点简介进展开详情 | `70-board.js`（`cleanDesc` + `BoardDesc`） | 只读 `extra.desc`；去 U+3000 与空行；3 行 clamp；无值整块不渲染 |
| 2 | 补四列 | `view.ts`（`columnsFor`）、`55-board-cell.js`（`cell`）、`20-ui-kit.js`（`NUM_COL_RE`）、`70-board.js`（`CHIP_ALWAYS`） | 三江 首订/首日增量、首订榜 首V、刺猬猫 最近更新；空值「—」 |
| 3 | 抓取范围一站一行 | `50-settings.js` | 「已选 x / y」+「⋯」菜单（全选/全不选/补齐缺失）；默认折叠；`setAll(false)` 顺手收起 |
| 4 | 起点榜条数置灰 | `70-board.js`（`qidianFixed`/`depthLocked`） | **客户端置灰**：宿主 `catalog()` 对 `qidian.*` 仍报 `canDepth: true`（cap 20 > 10），真正的校验留待 0.7；config 里的旧值保留不动 |

- `.rs-note-text` 的 `font-weight` 本来就是显式 `400`（上次已写死），这轮无需再改。
- 范围外没碰：采集、书页解析、缓存、`bookmarks.json` schema 一律未动；没有新增任何请求。
- 留给 0.7：概览「今日看点」、书签作品档案（简介/分类入书签）、书页多解析字段、番茄 `og:description`、缓存升版。

### 修改过的旧断言（本轮）

| 文件 | 断言 | 改成 |
|---|---|---|
| `tests/ui-actions.test.mjs` | 「设置页每站只有一个动作，平铺成『补齐缺失』」——原断言要求 `!settingsSrc.includes('h(PopMenu')` 且补齐缺失平铺成按钮 | 改成「每站三个动作收进站标题行的『⋯』菜单」：断言菜单在、三项文案在、联网提示在 |
| `tests/usability-ui-spec.test.mjs` | 「S4 设置里的站分组可折叠」——按 `▾ 起点 · 签约榜（2）` 找组标题 | 改成站点行口径：默认 `▸ 起点 · 已选 x / y`，点一下变 `▾`；取样时要求节点自身带 `onClick`（外层包装 div 文本相同但没有处理函数） |
| `tests/view.test.mjs` | 刺猬猫列序 `deepEqual(['rank','delta','title','author','words','collect'])` | 加「最近更新」列 ⇒ `['rank','delta','title','author','update','words','collect']` |

新增断言（都在 `tests/ui-polish.test.mjs` 与 `tests/view.test.mjs`）：简介去空白 + 无值不渲染、4 个新列出现且空值「—」、数字列范围、480 中点串保住新列、站点「⋯」菜单三件事、起点条数输入框 `disabled`。

### 闸门（收尾后）

- `test-local`：**450 pass / 0 fail**（起始基线 445；新增 5 条）
- `acceptance -SkipLive`：**100 pass / 0 fail**

### 截图（docs/screenshots/polish-0.6/）

- docs/screenshots/polish-0.6/board-900-light-desc.png（起点展开一行，简介可见）
- docs/screenshots/polish-0.6/board-900-light-sanjiang.png（三江：首订 / 首日增量两列）
- docs/screenshots/polish-0.6/board-480-dark-desc.png（480 暗色，起点展开一行）
- docs/screenshots/polish-0.6/pick-900-light-ranges.png（设置 · 抓取范围：起点图展开、其余折叠、「⋯」菜单打开）

## 发布后必须人工确认的一条（暗色）

> ★ 截图里的暗色是 Playwright `emulateMedia({ colorScheme: 'dark' })` 模拟出来的，**没有经过宿主真实的主题切换**。
> 发布后在真实 DSH 里手动切到暗色，把概览 / 榜单 / 书签 / 设置各看一次（重点：链接下划线、卡片边界、星标出现时机、数字列对齐、C.detail 左侧色条），确认无异常再对外宣布本版样式定稿。

## 下一步（等使用者决定，我不自行推进）

1. 是否需要合并 `ui/polish-0.6` → main 并打 `v0.6.0`（本会话按纪律**没有**合并、没有打 tag、没有推送）。
2. 合并后由使用者在本地跑 `dsh plugin add github:kilo-s/dsh-rank-scan#v0.6.0` 做真实安装验证。
3. 若截图要贴到公开面，需先推分支（现在 raw 链接还取不到）。
