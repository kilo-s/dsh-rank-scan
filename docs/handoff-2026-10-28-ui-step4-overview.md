# 第四步交接：概览信息结构（0.5.0）

- 分支：`ui/step4-overview`（从 0.4.2 合并后的 main 拉出）
- 提交：本分支 HEAD（0.5.0，验收后回填短 sha）
- 版本：0.5.0（package.json / package-lock / README / CHANGELOG）
- 状态：**已实现、离线测试与验收脚本已跑；未合并 main、未打 tag**，等验收。
- 前序：0.4.2 已合并 main（`6377dac`）并推送 tag `v0.4.2`。

## 做了什么

1. **四张数字卡**：`StatCard({label,value,sub,tone,onClick,title})`，大数字 `T.fs.l` 加粗 + tabular-nums，label/sub 用 `C.muted`；tone 只改左 3px 色条和数字色；有 onClick 是 button（focus-visible 蓝框），否则 div。
   - 已采集 ok/total；sub 未到计划 / 待补跑，失败时写「有榜没抓到」。
   - 待处理 0 写「无」且 ok；>0 按是否 error 类问题取 bad/warn。
   - 今日变化 chgRealTotal；sub 前两个分组。
   - 下次计划取 `schedule.waiting` 里最近站点时刻 + 站名；定时关闭写「已关闭」并跳设置；算不出时退回「上次扫描」。
   - 网格 `repeat(auto-fit, minmax(180px, 1fr))`：900px 一行 4 张，480px 2×2。**偏差说明**：方案写 140px，但 480px 面板内宽约 455px，140px 会排 3 列；为了让验收要求的 2×2 成立，改成 180px，仍是 auto-fit、不写死列数。
2. **顺序**：数据日期小字 → 四卡 → 主动作行 → 需要处理 → 补全 Banner → 今天的变化 → 全部榜单；「需要处理」提前到补全前。
3. **SectionHeader**：标题 + 右侧计数 + 可选操作，替换两处 `C.siteBar`；`innerRef` 给四张卡 `scrollIntoView({block:'nearest'})` 用，滚动容器是面板 body。
4. **空态**：
   - 当天未采集（ok=0 且无变化）显示「今天还没有采集结果，到计划时刻会自动跑，也可以点「扫描已选榜」」，不渲染变化表/分组筛选。
   - 有采集但无变化写「今天没有榜单变化」，不渲染分组筛选。
   - `/overview` 未到时四张卡占位「—」，不再整页「加载中…」。
5. **小尾巴 A**：板页单榜扫描通过 `onScanStart/onScanEnd` 接入 Panel 的 `scanActBusy`/ `postInFlightRef`；扫到一半切概览，「扫描已选榜」已置灰。409 统一 warn「已有扫描在进行，请等它跑完」。
6. **小尾巴 B**：上架日输入、本榜设置条数输入改用 `...C.input`，不再写死 `fontSize:'12px', padding:'2px 4px'`。

## 用到的现有字段 / 缺字段

没有为了本次改 host 接口或数据结构。使用：
- `ov.counts`、`ov.sites[].boards[]`（status/attempt/lastCapture/note/scheduleState/plannedTime）
- `ov.scan.outcome/inFlight/startedAt/progress`
- `ov.services.schedule.enabled/waiting/due/fallback/siteTimes`、`ov.dataDate`、`ov.hiddenCount`
- `/changes` 的 `count/sites/groups/count`
- `/enrich-status` 的 `pending/retryable/enrichRun`

**缺字段清单**：无必须新增字段。边界：
- `schedule.waiting` 为空且 `fallback` 为空、`scan.startedAt` 也没有时，下次计划显示「— / 暂时算不出下次」；没有为它新增 host 字段。
- `ov.sites` 为空时站点中文名用前端内置 5 站映射兜底（起点/起点图/刺猬猫/菠萝包/番茄），不算 host 字段缺失。

## 测试

- `scripts/test-local.ps1`：待填。
- `scripts/acceptance.ps1 -SkipLive`：待填。
- 新增 `tests/ui-overview.test.mjs`：6 条（顺序、4 处 StatCard、button/div、auto-fit+minmax、空态/无变化筛选、A 忙态/409、B 的 C.input）。
- 现有 ui-layout / ui-tokens / ui-settings-save / ui-actions / client-bundle / client-load 全绿。

## 手工冒烟

- 900×760 亮/暗：四张卡 + 主动作行首屏可见；点击「已采集」滚到全部榜单，点击「今日变化」滚到变化区；键盘 Tab 从「已采集」到「今日变化」，Enter 触发。
- 480×740 暗：2×2，无横向滚动（`scrollWidth=480, clientWidth=480`）；操作条自动换行。
- 拦截 `/scan` 挂起后从榜单页扫本榜并立刻切概览：「扫描已选榜」显示「扫描中…」且 disabled；恢复后正常。
- 拦截 `/scan` 返回 409：Toast 是 `rs-toast is-warn`，文字「已有扫描在进行，请等它跑完」。
- 定时关闭（拦截 overview 把 `schedule.enabled` 改 false）：下次计划卡变 button「已关闭 定时扫描」，点击切到设置页。
- 造数：当天未采集（sites=[], counts 全 0, changes 空）显示空态文案；有待处理（一条 missing）显示 19/20、待处理 1、红色 Banner、重试失败 1 个榜。
- 全程没有真实采集；配置保持 depth 20、interval 1000。

## 截图

本地：`docs/ui/after/step4-overview-{900-light,900-dark,480-dark,issue,empty}.png`（gitignored）。
入库副本：`docs/screenshots/step4-overview/`，推送后给出 raw GitHub 链接。

## 下一步

1. 验收分支/截图/两个脚本结果。
2. 通过后合并 main，打 tag `v0.5.0`（不要再问）。
3. 若验收要求把网格改回 140px，需同时接受 480px 排 3 列，或改成窄屏媒体查询（会偏离「不写死列数」的约束）。
