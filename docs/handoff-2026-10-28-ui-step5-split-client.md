# 第五步交接：拆分 client.js（0.5.1）

- 分支：refactor/step5-split-client（从 v0.5.0 合并后的 main 拉出）
- 提交 1（纯搬家）：fed18ce
- 提交 2（可读性）：`fe7aff7`
- 版本：0.5.1
- 状态：**未合并 main、未打 tag**，等验收。

## 拆分布局

按现有顶层边界切分（文件名排序拼接），实际顺序与方案表略有调整：

| part | 原始行范围 | 行数 | 内容 |
|---|---:|---:|---|
| 00-head.js | 1–155 | 155 | 文件头、loader 入口、React/h/API、jget/jpost/readResponse |
| 10-tokens.js | 156–270 | 115 | T/C、wash、ensureStyle |
| 20-ui-kit.js | 271–780 | 510 | Banner/Toast/PopMenu/Section/格式化/列宽/useRect |
| 25-bookmark-star.js | 781–947 | 167 | healStore、BookmarkStar |
| 30-window.js | 948–1027 | 80 | useWindowDrag、DragBar、ResizeHandle |
| 40-overview.js | 1028–1511 | 484 | fmtBytes、StatCard、SectionHeader、nextPlanOf、Overview |
| 50-settings.js | 1512–2108 | 597 | settingsDiff/retention、SettingsTab、VersionRow |
| 55-board-cell.js | 2109–2206 | 98 | cell、BOARD_NAMES、boardLabel |
| 60-bookmarks.js | 2207–2606 | 400 | bookKeyOf、DetailBookmarkEditor、BookmarksTab |
| 70-board.js | 2607–3105 | 499 | BoardTab |
| 80-panel.js | 3106–3360 | 255 | SidebarEntryIcon、Panel |
| 90-tail.js | 3361–3470 | 110 | openLink/diagLink、inject、apply、factory 闭合 |

偏差（以字节一致为准）：
- 原方案把 useRect 放 30-window，但它在 healStore/BookmarkStar 之前；实际放进 20-ui-kit。
- 原方案 60-bookmarks 含 BookmarkStar，但它在 30-window 之前；实际拆成 25-bookmark-star 与 60-bookmarks。
- cell 在 BookmarksTab 之前，实际单独 55-board-cell。
- StatCard/SectionHeader/nextPlanOf 与 Overview 连续，放在 40-overview。

## 提交 1

- 用一次性脚本按行号切分（不手工复制）；拼接结果 sha256 = c8967d30e4fea3a4e77410b2d283acee3c2c5ad670fde72618025615476c1fa2，与 v0.5.0 的 client/client.js 字节一致，字节数 224231。
- build.mjs 读 client/parts/*.js 按名排序直接拼接；删除 client/client.js。
- 新增 tests/_client-source.mjs（readClientSource）与 tests/client-source-lock.test.mjs（一次性哈希守门，提交 2 删除）。
- 所有读 client/client.js 的测试改读 helper；acceptance 的装配闸改为 parts 拼接；DEVELOPMENT.md 路径更新。
- 验证：test-local **414 pass / 0 fail**（54 文件）；acceptance **PASS 97 / FAIL 0**。

## 提交 2

- 每个 part 顶部加职责/依赖/不该放什么注释（3 行）；build 在每个 part 前插 /* ---- parts/NN-name.js ---- */。
- 删除一次性哈希守门；新增 tests/client-parts.test.mjs：命名/编号、单文件 ≤900 行、new Function 语法、顶层 function 不跨 part 重复。
- 版本 0.5.1（package.json / package-lock / README / CHANGELOG）。
- 验证：test-local **417 pass / 0 fail**（54 文件）；acceptance **PASS 97 / FAIL 0**。

## git 直装

- 宿主 desktop profile 由 Electron 独占；在隔离的 `DSH_HOME` 下 `dsh plugin --profile step5-test add github:kilo-s/dsh-rank-scan#refactor/step5-split-client` 能初始化临时 profile，但 pnpm 调 `git ls-remote` 时被当前沙箱以 `spawn EPERM` 拒绝（不是包/分支本身的问题）。
- 用 `git archive HEAD` 导出干净树 + `npm ci`（会跑 package.json 的 prepare → build.mjs）跑通：lib/client.js 产物存在，sha256 `39874FA7…4F854B5`；在该干净树里 client-bundle 12/0、client-load 6/0。
- 仍建议在有 DSH 桌面权限/可 spawn git 的环境补一次真正的 `dsh plugin add`。

## 下一步

1. 验收两个 commit 与切分表。
2. 通过后合并 main、打 tag v0.5.1。
