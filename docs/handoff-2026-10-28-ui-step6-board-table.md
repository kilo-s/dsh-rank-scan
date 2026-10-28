# 第六步交接：榜单页表格交互（0.5.2）

- 分支：ui/step6-board-table（从 v0.5.1 合并后的 main 拉出）
- 版本：0.5.2
- 状态：**已实现，未合并 main、未打 tag**，等验收。
- 改动文件：client/parts/70-board.js（主要）、client/parts/10-tokens.js（通用 hover/focus/排序箭头样式）、src/index.ts + src/scan/view.ts（宿主 sortOptions / defaultSortKey）；55-board-cell.js 未改。

## 做了什么

0. 宿主排序口径
   - sortOptionsFor 不再提供「名次」排序项；sort=rank 视同未指定。
   - 响应新增 defaultSortKey：普通榜 rank 升序、三江 collectBase 降序、番茄派生榜 value 降序；/day 也带。

1. 点表头排序
   - 可点列 = 当前榜 sortOptions 里有对应 value 的列 + defaultSortKey 对应的默认列；th 内渲染 button（无边框、继承字体）。
   - 未激活列点击后按该列排序；再点激活列回到 ''。和上方「排序」下拉共用 ss 与 sel.setPref。
   - 默认态激活 defaultSortKey 对应列（普通榜名次 ↑，三江/派生榜 ↓）；显式排序一律 ↓；th 带 aria-sort，未激活可排序列 hover/focus 显示淡色箭头。
   - 排序切换收起详情，并把列表滚回顶部（listRef.scrollIntoView block:start）。
2. 展开行
   - 表格行与窄屏卡片都有 aria-expanded。
   - 展开行背景 T.subtle，第一个 td 用 inset 3px T.accent 左条；详情卡保留底色并加同色左条。
   - 行/卡片 :focus-visible 显示与按钮一致的蓝框。
3. 键盘
   - 行内 ↑/↓/Home/End 按 data-row-idx 找相邻数据行（详情行不参与），Enter/空格展开/收起。
   - 移动焦点 scrollIntoView({ block: 'nearest' })；不自动展开。
   - 焦点在行内 a/button/input/textarea/select/contenteditable 上时不拦截方向键。
   - 详情 Esc 或「关闭」收起，并把焦点还给原行。
4. 详情卡
   - 动作顺序：在 DSH 侧栏浏览器打开（primary）、复制链接、新标签打开（链接）、关闭（ghost，margin-left:auto）。
   - 复制链接用 navigator.clipboard.writeText(...).then(...).catch(...)；成功 Toast「已复制链接」，失败 warn 并附链接。
5. 说明与测试
   - 表格下方说明改为默认收起的 details「列说明」，内容原样保留。
   - client-parts 的末尾换行断言在第五步已加，本步未重复。

## 口径 / 偏差

- 只展示当前 fitColumns 后仍在表格里的列对应的排序入口；被宽度收起的列不生成表头，但仍可用上方排序下拉（下拉本来就保留给窄屏卡片和无对应列的排序项）。
- 宿主 sortOptions 不再提供「名次」项；默认态由响应的 defaultSortKey 表达（普通榜 rank 升序、三江 collectBase 降序、番茄派生榜 value 降序）。显式排序一律倒序，客户端箭头按 defaultSortKey / descending 显示；旧 sort=rank 请求视同未指定。
- 行的键盘导航用 data-row-idx + 容器 onKeyDown，没有为每行建 ref 数组。
- 55-board-cell.js 未改；通用排序箭头/focus 样式放在 10-tokens.js，已在改动文件里说明。
- 测试缝 window.__rankScanBoardTableTest 仍常驻挂载；仓库没有统一的测试环境开关，本步不为此扩大改动。

## 测试与冒烟

- 新增 tests/ui-board-table.test.mjs：sortableCols、nextSort、nextRowIdx、旧偏好归一、aria/复制 Promise 源码断言，4/0。
- 新增 tests/default-sort-key.test.mjs：defaultSortKeyFor 三种榜、sortOptions 无 rank、sort=rank 与不传 sort 顺序一致、/day 也带 defaultSortKey，3/0。
- test-local：**425 pass / 0 fail**（56 文件）。
- acceptance -SkipLive：**PASS 99 / FAIL 0**。
- 手工冒烟：默认态名次 ↑、下拉显示「默认（名次）」且无 rank 选项；900px 表头切换与下拉同步、再点回默认、切榜保持偏好；行 ↑/↓/Home/End/Enter/Esc 与 480px 卡片重复通过；复制链接 success 与禁用 clipboard 的 warn 都出现；暗色 focus 蓝框可见。

## 截图

- 900px 亮色（收藏↓ + 展开一行，展开行在 sticky 表头下方）：docs/screenshots/step6-board-table/step6-board-table-900-light.png
- 900px 暗色默认态（名次 ↑ + 下拉「默认（名次）」）：docs/screenshots/step6-board-table/step6-board-table-900-dark.png
- 480px 真正暗色卡片展开 + 另一张 focus 框：docs/screenshots/step6-board-table/step6-board-table-480-dark-card.png

## 下一步

1. 验收本分支。
2. 通过后合并 main、打 tag v0.5.2。
3. 第七步书签页另开分支，等验收后再发。
