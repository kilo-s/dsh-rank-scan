# 扫榜面板下一阶段交接（2026-10-28 建，2026-10-30 按现状重写）

## 一句话现状

main = `4f05f6a` = v0.6.2（tag v0.6.2，npm latest 0.6.2）；一到六步 UI 路线与 0.6.0 / 0.6.1 / 0.6.2 三批精修全部落地。下一步候选见文末，动手前先确认范围。

## 仓库与版本

- 插件：dsh-rank-scan（DSH 扫榜面板）
- main：`4f05f6a` `Release v0.6.2: depth control only where it works`
- tag：v0.6.2（指向 `4f05f6a`）；累计 17 个 release（v0.1.0 → v0.6.2）
- npm：`dsh-rank-scan` latest = **0.6.2**（CI 构建包；面板「检查更新」读的就是这个号）
- 版本：package.json = 0.6.2；README 的钉版本示例 = v0.6.2 / 0.6.2
- 工作区：除交接文档外保持干净；**不要自行合并、打 tag、推送**
- 验证基线：0.6 收尾那一轮的记录是 test-local 453 pass / 0 fail、acceptance -SkipLive 100 pass / 0 fail；0.6.2 之后未重跑整条基线，动代码前先跑一遍

## 已完成范围

1. 第四步：概览信息结构；全部跑完后「下次计划」跨日显示「明天 HH:mm」+ 榜名；0 榜空态；计划常态中性色。（v0.5.0）
2. 第五步：client/client.js 拆成 client/parts/*.js，由 build.mjs 按文件名排序拼接；零依赖、无 JSX、无打包器。（v0.5.1）
3. 第六步：榜单页表头排序、展开行高亮、行键盘导航、复制链接 Toast、折叠「列说明」。（v0.5.2）
   - 宿主移除「名次」排序项，sort=rank 视同未指定；defaultSortKey 表达默认列方向。
   - 客户端默认态名次 ↑；显式排序一律 ↓；旧 sort=rank 偏好归为默认。
4. 0.6.0：视觉精修整批（A–E）—— 令牌收敛、榜单页数字列右对齐、书签页重做成三行卡片 + 排序 + 分批、概览与设置对齐。
5. 0.6.1：全站去掉「最近更新 / 更新时间」列；番茄「在读周榜」改用最新一个真有番茄快照的日期建池。
6. 0.6.2：「每榜条数」只对适配器真读 depth 的榜开放（canDepth），派生榜不出「扫描本榜」，操作条回到一句话。
   - 三批细节见 docs/handoff-2026-10-28-ui-polish-0.6.md。

## 代码地图

- src/index.ts：宿主路由、/board、/day、/scan、设置等；含 defaultSortKey 与 sort 口径。
- src/scan/view.ts：纯函数；defaultSortKeyFor、defaultSortFor、compareDesc、列策略等。
- client/parts/00-head.js：loader、API 请求、sel 选择记忆。
- client/parts/10-tokens.js：T/C 令牌、wash、ensureStyle（通用 hover/focus/排序箭头样式）。
- client/parts/20-ui-kit.js：Banner、Toast、PopMenu、Section、fitColumns、useRect。
- client/parts/25-bookmark-star.js：书签 store 的 healStore、BookmarkStar。
- client/parts/30-window.js：浮窗拖拽/缩放。
- client/parts/40-overview.js：概览页。
- client/parts/50-settings.js：设置页。
- client/parts/55-board-cell.js：单元格渲染、榜名。
- client/parts/60-bookmarks.js：书签页（0.6.0 已重做成三行卡片 + 排序 + 分批）。
- client/parts/70-board.js：榜单页（表头排序、展开行、操作条）。
- client/parts/80-panel.js：Panel 外壳、页签、轮询。
- client/parts/90-tail.js：openLink、apply、__test。
- scripts/build.mjs：tsc host + 按名拼接 client/parts 到 lib/client.js；lib/ 不入库。
- tests/_client-source.mjs：测试读取 parts 的统一入口。
- tests/client-parts.test.mjs：命名、行数、语法、末尾换行、顶层函数不重复。

## 常用命令

在仓库根执行：

```powershell
npm run build
./scripts/test-local.ps1
./scripts/acceptance.ps1 -SkipLive
```

- test-local 逐个运行 tests/*.test.mjs；不要依赖 node --test 的自动 spawn。
- acceptance 会跑全部离线测试和公开面闸门；发布前必须绿。
- 手工面板开发用 dev_* 注入/热重载；live 页面地址以当前环境为准。

## 已知坑

- node_modules 可能为空或被失败的 npm ci 清掉；缺 typescript 时用工作区 npm cache 重跑 npm ci，不要用系统默认 AppData cache（沙箱可能拒绝）。
- 公开面闸门禁词以 scripts/acceptance.ps1 的 bannedWords 数组为准；写文档或提交信息前先跑一次相关检查。
- 截图暗色**不是**靠手写 data-ds-dark-theme：宿主主题挂在 data-ds-theme-source 上，手写属性不换色；要用 Playwright `emulateMedia({ colorScheme: 'dark' })`。（2026-10-28 拍图时实测踩过）
- 表格 sticky 表头会压住展开行；截图前把展开行 scrollIntoView 到表头下方。
- 测试读的是 client/parts 拼接结果，不是 lib；改完要 build 再跑客户端测试。
- 不要修改 lib/client.js；它由 build 生成且不入库。
- 不发版、不合并、不打 tag、不推送，除非使用者明确授权。

## 下一步候选（不在本次范围内，动手前先确认）

0.7 清单（照 0.6 收尾记录留给 0.7 的那一份）：

- 概览「今日看点」。
- 书签作品档案（简介/分类入书签）。
- 书页多解析字段。
- 番茄 og:description。
- 缓存升版。

另两条已知项：

- **三江「今日增量」整列是「—」**（0.6 之前就这样）：cell 读 extra.dailyDelta，而三江行只有 extra.daily[] / extra.totalDelta；真正的值是「第 N 天」那几列 + 期累计。见 docs/handoff-2026-10-28-ui-polish-0.6.md 的「已知未修」。
- **发布后暗色人工核查**：截图里的暗色是 Playwright 模拟的，未经宿主真实主题切换；发布后在真实 DSH 里手动切到暗色，把概览 / 榜单 / 书签 / 设置各看一次（重点：链接下划线、卡片边界、星标出现时机、数字列对齐、C.detail 左侧色条）。

## 待办（使用者侧）

- 本地真实安装验证：`dsh plugin add github:kilo-s/dsh-rank-scan#v0.6.2`（沙箱不能 spawn git，已完成 git archive + npm ci 替代验证）。

## 参考文档

- 0.6.0 / 0.6.1 / 0.6.2：docs/handoff-2026-10-28-ui-polish-0.6.md
- 第四步：docs/handoff-2026-10-28-ui-step4-overview.md
- 第五步：docs/handoff-2026-10-28-ui-step5-split-client.md
- 第六步：docs/handoff-2026-10-28-ui-step6-board-table.md
- 开发约定：docs/DEVELOPMENT.md
