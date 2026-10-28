# 交接：0.6.0 视觉精修整批

- 日期：2026-10-28
- 分支：`ui/polish-0.6`（从 main v0.5.2 = 3f32906 拉出）
- 范围依据：[plan-0.6.0-polish.md](plan-0.6.0-polish.md)（唯一权威；早先的 handoff-2026-10-28-panel-next.md 已作废）
- 版本：开发期 0.5.2 → 收尾提交改 0.6.0；**不合并、不打 tag**

## 进度

| 主题 | 状态 | 提交 |
|---|---|---|
| 准备工作（分支 / 方案 / 交接 / 夹具脚本） | 进行中 | — |
| A 视觉令牌（10-tokens / 20-ui-kit） | 未开始 | — |
| B 榜单页（70-board / 55-board-cell） | 未开始 | — |
| C 书签页（60-bookmarks） | 未开始 | — |
| D 概览页与设置页收尾对齐 | 未开始 | — |
| E 测试（tests/ui-polish.test.mjs） | 未开始 | — |
| 收尾（0.6.0 / CHANGELOG / acceptance / 截图） | 未开始 | — |

## 闸门基线

- `npm run build` 必绿（tsc host + 拼接 client/parts）
- `./scripts/test-local.ps1`：425 pass / 0 fail（56 文件）
- 收尾再跑 `./scripts/acceptance.ps1 -SkipLive`：99 pass / 0 fail

## 口径备忘（实施时逐条对照方案）

- 卡片最多三行，900 与 480 同一套，靠 nowrap + 省略，不写 480 特判。
- 排序纯函数 sortBookmarks(list, key)，null 一律排最后，只排当前筛选结果，状态落 localStorage rank-scan-panel:bm:sort:v1。
- 分批 50，全选与导出「当前筛选」基于全量筛选结果；正在编辑的项即使超出已渲染范围也必须渲染。
- 颜色只用 T 变量；不改 host 接口与数据口径；书签增删改 / 导出 / 回收站语义不变。

## is-primary 清单

（收尾回报时回填）

## 修改过的旧断言

（收尾回报时逐条回填）

## 已知坑（沿用前几轮）

- 改 client/parts 后必须 build 再跑客户端测试（测试读的是拼接结果，不是源码）。
- 暗色截图要在页面 reload **之后**设置 data-ds-dark-theme。
- 表格 sticky 表头会压住展开行；截图前把展开行 scrollIntoView 到表头下方。
- 验收夹具不得写真实数据目录；长列表用 `scripts/make-bm-fixture.ps1` 生成隔离目录。
