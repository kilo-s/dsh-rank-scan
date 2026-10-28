# 第六步交接：榜单页表格交互（0.5.2）

- 分支：ui/step6-board-table（从 v0.5.1 合并后的 main 拉出）
- 版本：0.5.2
- 状态：**已实现，未合并 main、未打 tag**，等验收。
- 改动文件：client/parts/70-board.js（主要）、client/parts/10-tokens.js（通用 hover/focus/排序箭头样式）；55-board-cell.js 未改。

## 做了什么

1. 点表头排序
   - 表头列 key 在当前榜 sortOptions 的 value 里时，th 内渲染 button（无边框、继承字体）；名次列对应 rank。
   - 未激活列点击后按该列排序；再点激活列回到 ''。和上方「排序」下拉共用 ss 与 sel.setPref。
   - 激活列显示方向箭头（所有排序列都是 ↓），th 带 aria-sort；未激活可排序列 hover/focus 显示淡色箭头。
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
- 宿主 sortOptions 没有方向字段；src/index.ts 的 effSort 对包括 rank 在内的所有排序都用 compareDesc（倒序），客户端一律 descending / ↓，不设 rank 特例。
- 行的键盘导航用 data-row-idx + 容器 onKeyDown，没有为每行建 ref 数组。
- 55-board-cell.js 未改；通用排序箭头/focus 样式放在 10-tokens.js，已在改动文件里说明。
- 测试缝 window.__rankScanBoardTableTest 仍常驻挂载；仓库没有统一的测试环境开关，本步不为此扩大改动。

## 测试与冒烟

- 新增 tests/ui-board-table.test.mjs：sortableCols、nextSort、nextRowIdx、aria/复制 Promise 源码断言，4/0。
- test-local：**422 pass / 0 fail**（55 文件）。
- acceptance -SkipLive：**PASS 98 / FAIL 0**。
- 手工冒烟：900px 表头名次/字数切换与下拉同步、再点回默认、切榜保持偏好；行 ↑/↓/Home/End/Enter/Esc 与 480px 卡片重复通过；复制链接 success 与禁用 clipboard 的 warn 都出现；暗色 focus 蓝框可见。

## 截图

- 900px 亮色（收藏↓ + 展开一行，展开行在 sticky 表头下方）：docs/screenshots/step6-board-table/step6-board-table-900-light.png
- 900px 暗色同一状态：docs/screenshots/step6-board-table/step6-board-table-900-dark.png
- 480px 真正暗色卡片展开 + 另一张 focus 框：docs/screenshots/step6-board-table/step6-board-table-480-dark-card.png

## 下一步

1. 验收本分支。
2. 通过后合并 main、打 tag v0.5.2。
3. 第七步书签页另开分支，等验收后再发。
