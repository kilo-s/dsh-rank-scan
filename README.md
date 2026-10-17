# dsh-rank-scan

[![Release](https://img.shields.io/github/v/release/kilo-s/dsh-rank-scan)](https://github.com/kilo-s/dsh-rank-scan/releases)

DeepSeek Harness 扫榜插件：定时 + 按需采集多站小说榜单，算变化，在一个面板里挑着看。
只读站点公开榜单与书页 —— 不登录、不抓正文、不推送；全部数据留在本地数据目录。

> **本插件不注册任何 DSH 工具**。对外能力只有两样：面板 UI（左侧栏「扫榜」入口 + 浮窗）与同源 HTTP 路由 `/api/rank-scan/*`。
> 装配入口是 `cordis.patch.yml`（由 `package.json` 的 `dsh.bundle.patch` 指向）。

> works on DSH 0.2.0.x（桌面版 0.2.0 线；`package.json` 的 `engines.dsh` 写的是 `>=0.1.0 <1`，但面板与路由只在这条线上验过）。

## 安装 / 更新

任选一条。两条都要求**先完全退出 DSH 桌面版**（profile 由桌面应用独占管理），装完重开 DSH 即可。

### A. 一条命令（推荐）

```sh
dsh plugin --profile desktop add github:kilo-s/dsh-rank-scan
# 钉版本：github:kilo-s/dsh-rank-scan#v0.2.4
```

仓库不含编译产物，这条命令会在安装时现场构建 `lib/`。首次可能被 pnpm 拦下构建脚本（它会打印要放行的键，加进 `allowBuilds` 后重跑即可），细节见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

### B. 离线：装 Release 附件

从 [Releases](https://github.com/kilo-s/dsh-rank-scan/releases) 下载 `dsh-rank-scan-*.tgz`，**完全退出 DSH 桌面版**后：

```sh
dsh plugin --profile desktop add "<tgz 的完整路径>"
```

需要脚本化安装 / 卸载（`install.ps1`、`uninstall.ps1`）或想知道包里为什么不带 `scripts/`，见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

**验证**：重开 DSH 后左侧栏会话列表下方应出现「扫榜」入口；或访问 `http://127.0.0.1:19387/api/rank-scan/health`，返回 `{ok:true,...}` 即通。

**更新**：重跑安装命令即可（链接直装取最新 main）；装了 [dsh-market](https://github.com/dsh-market/dsh-market) 的话，面板「抓什么」页底部能就地检查更新（0.2.3 起已发布到 npm）。

**卸载**：`dsh plugin --profile desktop remove dsh-rank-scan`。数据目录 `~/.dsh/data/rank-scan` 会保留，要彻底清理自行删除；脚本化卸载与 patch 安全口径见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。


## 能做什么

| 能力 | 说明 |
|---|---|
| 五站采集 | **起点**签约榜 × 15 分类（默认轻小说；其余分类勾了才抓，移动端口径）· **起点图**首订榜 / 三江·推荐效果（周）· **刺猬猫**点击榜(周) / 新书榜(周) / 首订(约) · **番茄**男频新书榜 × 8 分类 · **菠萝包**新书榜(点击) / 轻小说热榜(周) / VIP 热销榜(周) |
| 派生榜 | 番茄「在读周榜（候选池内）」由已落盘快照本地计算，**不发请求**；不足 7 天标 `N/7` |
| 变化集 | 新入榜 / 回榜 / 上升 / 下降 / 退榜分开列；在榜天数；基准日；无基准时一律「—」，**不报 0** |
| 周期榜换期 | 起点图三江当期无数据自动回退上一期（最多 2 期）；**换期当天变化列判不可比**并标注「新期」 |
| 状态五态 | `ok` / `missing` / `stale` / `login_required` / `truncated`；**缺失一律 `null`，绝不补 0** |
| 按需补全 | 起点/起点图三江精确字数（+起点收藏）、番茄干净书名/作者、刺猬猫与菠萝包字数与收藏；结果就地覆盖当天快照，可重复补（幂等） |
| 补全后台化 | 抓榜一结束就返回，补全在后台逐榜跑，面板顶部显示「补全中 N/M」；**通用书页缓存**（起点/刺猬猫/菠萝包/番茄共用，默认 7 天）命中即不再进书页 |
| 请求间隔 | 真实请求之间的最小间隔**可配**：面板「抓什么」页可选 200ms / 500ms / 1000ms / 2000ms / 5000ms 或「不限速（仅本地测试）」，**默认 1000ms 不变**，改完立即生效 |
| 落盘纪律 | 按数据日期落快照，原子写、同日覆盖即幂等；精简索引 / 保留清理 / 导出 |
| 定时扫描 | 按站分时，**默认开启**，安装当天不跑；面板可改时刻与开关，**改动跨重载保留** |
| 面板记忆 | 浮窗位置与尺寸、收起状态、当前页签、正在看哪天，都在刷新后恢复 |
| 版本与更新 | 面板显示当前版本；**0.2.3 起已发布到 npm**（v0.2.2 只有 Release 附件），装了 dsh-market 可查新版本并「一键更新」；npm 查不到时面板会明确提示，回退 Release 附件 / 仓库链接；没装 dsh-market 则只读（不硬赌能力） |
| 防卡死 | 单请求 15s / 单榜 90s / 单站连败 3 次熔断 / 120s 无进展看门狗 / 扫描锁 + 心跳（心跳过期可接管） |
| 书签 | 面板内收藏作品、备注夹、回收站、导出 |

## 用法

### 面板（四个页签）

| 页签 | 做什么 |
|---|---|
| **概览** | 一行汇总（数据日期 / 基期 / 榜数 / 异常数 / 隐藏数 / 上次扫描）+ 按站分组的单表；异常榜折叠；下方接「今天的变化」 |
| **当前榜单** | 站 → 榜 → 日期 → 排序四级控件；「每榜取 N 条」；点任意一行展开行内详情卡（书名/作者/字数/更新时间 + 在站点打开 + 复制链接） |
| **我的书签** | 卡片列表 + 搜索 / 按站与备注夹过滤 + 备注编辑 + 回收站 + 手动添加 + 导出 |
| **抓什么** | 站 → 榜种 → 分类勾选（**改了先点保存**，下次扫描生效）+ 按站时刻与定时开关 + 版本区 |

浮窗标题栏可拖动、右下角把手可缩放，位置与尺寸本地记忆。面板改完客户端记得**刷新页面**（客户端 bundle 由页面加载）。

### 定时扫描

- **默认开启**，但**安装当天不自动跑**（次日按时刻跑）；面板「抓什么」页可关掉或改时刻，关掉后重载仍保留。
- 按站分时：每个站可以有自己的抓取时刻，兜底时刻 22:30。
- 同一时刻只有一轮扫描（定时与手动共用一把锁，冲突时手动请求返回 409）。
- 诊断日志：`<dataDir>/state/timer.log`（接线 / 迁移 / 每轮开始结束各一行）。

### HTTP 路由（同源、只读本地快照，渲染不联网）

| 路由 | 说明 |
|---|---|
| `GET /api/rank-scan/health` | 自检：路由是否挂上（端口 / 数据目录 / 数据日期列表） |
| `GET /api/rank-scan/overview` | 概览：数据日期 / 基准日 / 五态计数 / 隐藏榜数 / 每站每榜状态与涨新退 |
| `GET /api/rank-scan/board?boardId=&date=&sort=` | 当前榜单：列随榜、缺失显示「—」、当天无快照时回落最近可用并标注日期 |
| `GET /api/rank-scan/changes` | 今天的变化：按站编组，组内固定 新入榜/回榜/上升/下降/退榜 |
| `GET /api/rank-scan/catalog` | 可选榜清单：站 → 榜种 → 分类 + 是否已勾选 + 各榜深度 + 定时状态 |
| `POST /api/rank-scan/scan` `cancel` `retry` | 立刻扫一次（可带 `{boards}` 只扫指定榜）/ 取消 / 只重跑当天非 ok 的榜 |
| `POST /api/rank-scan/select` `depth` `timer` | 抓取集与显示集 / 每榜取数（1–100）/ 定时开关与时刻 |
| `POST /api/rank-scan/enrich?boardId=` `enrich-all` | 按需补全某榜或抓取集内全部分类榜的字段 |
| `GET/POST /api/rank-scan/bookmarks` `bookmark` `bookmark/sync` `bookmark/export` `bookmark/trash` | 书签列表 / 单条增删改 / 同步 / 导出 / 回收站 |
| `GET /api/rank-scan/version` `update-check`，`POST /api/rank-scan/update` `update-restart` | 版本读数与一键更新（只走 dsh-market 公开的更新 API v1；宿主不支持重启时明确拒绝并提示自行重启） |

来源闸（宿主对 `/api/rank-scan/*` 不做鉴权，插件自己加了一道）：请求带了 `Origin` 或 `Referer`、且其 host 与本次请求的 Host 不同源 ⇒ **403**；`Origin: null`（沙箱 iframe / `file://`）也拒；**两个头都不带 ⇒ 放行**。最后这条是**有意为之**：curl、PowerShell 脚本、你自己机器上的进程本来就能直接操作系统，这道闸门防的是「浏览器里的第三方页面」，不是本地可控进程。

## 数据与隐私

- **只读**站点公开榜单与书页；**不登录、不抓正文、不推送**任何地方。
- 采集纪律：限速**默认 1s/请求**（面板「抓什么」页可下调到 200ms，或显式设 0 = 关闭限速、**仅建议本地测试**）、每榜**每日 1 次**、失败重试 **≤2** 次。
- 时间口径：落盘时间戳是绝对时刻、面板显示成本地时刻，但**非 +08:00 时区未测**（测试与 CI 只跑 `Asia/Shanghai`）。
- 数据目录默认 `~/.dsh/data/rank-scan/`（插件配置 `dataDir` 可改）：

```text
<dataDir>/<数据日期>/<boardId>.json   快照（rows + metric）
<dataDir>/<数据日期>/scan.json        本次扫描元信息（attempt / outcome / progress / 每榜状态）
<dataDir>/state/scan.lock.json        扫描锁（含心跳时间）
<dataDir>/state/retries.json          各榜当日重试次数
<dataDir>/state/cancel.json           取消标志
<dataDir>/state/timer.log             定时诊断
<dataDir>/state/qidian-book-cache.json 起点书页缓存（TTL 内不重复下载）
<dataDir>/font-map.json               番茄字体映射（私用区码点 → 真字）
```

数据只在本地，插件不写工作区内任何文件。

## 排障

**左侧栏没有「扫榜」入口**（按顺序看）：

1. **先确认装到了你正在跑的那个 profile**：安装脚本结束时打印「本次装到 profile 「x」」，跟你实际启动的 profile 对不上就会**静默不出现**（不报错）；可核对 `~/.dsh/profiles/<你跑的 profile>/node_modules/dsh-rank-scan` 是否存在；
2. DSH 启动日志里搜 `did not activate` 与 `pending (waiting for services`：前者 = 面板 bundle 没加载成功，后者 = 缺 timer / webServer 服务；
3. 访问 `/api/rank-scan/health`：能返回 JSON ⇒ host 侧活着，问题在面板；连不上 ⇒ 插件没装上；
4. 重装一次：`pwsh -File scripts\install.ps1 -Spec "<tgz>"`（缺省 `-Spec` 走目录直装，要求仓库目录已构建出 `lib/index.js`，否则脚本会直接报错退出）。

**面板点不开 / 点了没反应**：先确认点的是哪颗按钮 —— DSH 的侧栏会把插件入口包进它自己的一行 `<button>`，我们的入口嵌在里面（DOM 里因此有两颗文本相同的 button，外层那颗不是我们的 handler）。

**某个榜显示 `missing` / 一列都是「—」**：先看是不是数据源本身就没有这个字段（例如站点榜单页不给字数与收藏，需要点「补全」进书页取）；本插件对缺失一律显示「—」，不会编造 0。

**DSH 起不来 / 日志提示 patch 解析失败怎么办**（`must be a top-level YAML array of loader entries`、`failed to parse overlay`）：

profile 的 `cordis.patch.yml` 被改坏了（手动编辑、或旧版卸载脚本删条目留下的孤儿行）。**宿主自己修不了** —— 它写 patch 之前先要求「顶层是 YAML 数组」，文件已经不合法时就卡死，别指望在 GUI 里点回去。用救援脚本（只碰这一个文件，先备份）：

```powershell
pwsh -File scripts\repair-patch.ps1 -DryRun     # 先看判定，不写盘
pwsh -File scripts\repair-patch.ps1             # 只有不可解析才动手：备份 → 回写成 []（空 overlay）
pwsh -File scripts\repair-patch.ps1 -Restore    # 想退回：用最近的备份还原
```

macOS / Linux：`bash scripts/repair-patch.sh desktop -DryRun`。脚本只认 `~/.dsh/profiles/<profile>/cordis.patch.yml` 这一个文件，用 `-Profile <名字>` 换 profile。

那个文件每一行是什么：

```yaml
- id: dsh-rank-scan          # 一条 loader 条目：顶层数组的一项，「- 」必须从第 1 列开始
  disabled: true            # 宿主「禁用插件」时写的字段；留着合法，删掉也行
- insert:                   # 另一种合法形态：把下面的条目插进某个父节点
    - id: dsh-rank-scan
      disabled: true
```

**只有注释 / 空行**，或者出现**不以上述 `- ` 开头、却顶在第 1 列的散行**（例如孤零零一行 `disabled: true`）—— 这两种都会让宿主启动失败；`[]` 是最小合法文件（= 没有 overlay）。修完这样验证：`dsh --profile <profile> --dump-config` 退出码 0，再重开 DSH。

> 为什么卸载脚本不动它？自动改写 YAML 恰恰是把 patch 改坏的主要来源（删一行就留孤儿）。所以卸载脚本只「读 + 打印」，宁可留一条 `disabled` 残留，也不冒把文件改坏的风险 —— 本插件不承诺「patch 零残留」。

**站点改版**：先跑夹具测试（`node tests/qidian-fixture.test.mjs` 等），再看 `tests/fixtures/` 里的响应快照哪里变了。

## 开发

构建、测试、设计约束、目录结构、面板与宿主路由结构、验收闸门与依赖纪律，见 **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**；版本变更历史见 **[CHANGELOG.md](CHANGELOG.md)**。

## 许可证

BSD-3-Clause，见 [LICENSE](LICENSE)。
