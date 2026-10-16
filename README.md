# dsh-rank-scan

[![Release](https://img.shields.io/github/v/release/kilo-s/dsh-rank-scan)](https://github.com/kilo-s/dsh-rank-scan/releases)

DeepSeek Harness 扫榜插件：定时 + 按需采集多站小说榜单，算变化，在一个面板里挑着看。
只读站点公开榜单与书页 —— 不登录、不抓正文、不推送；全部数据留在本地数据目录。

> **本插件不注册任何 DSH 工具**。对外能力只有两样：面板 UI（左侧栏「扫榜」入口 + 浮窗）与同源 HTTP 路由 `/api/rank-scan/*`。
> 装配入口是 `cordis.patch.yml`（由 `package.json` 的 `dsh.bundle.patch` 指向）。

## 安装 / 更新

两条路任选一条。**两条都要求先完全退出 DSH 桌面版** —— 这是宿主自己的规矩（profile 由桌面应用独占管理），不是本插件的要求，也不需要重启电脑。装完重开 DSH 即可。

### 一、从仓库链接直装（不用先下载文件）

```sh
dsh plugin --profile desktop add github:kilo-s/dsh-rank-scan
# 想钉版本：github:kilo-s/dsh-rank-scan#v0.2.1
```

- 安装时会**现场从源码构建**：仓库不含编译产物，靠 `package.json` 的 `prepare` 在安装时跑 `scripts/build.mjs` 生成 `lib/`。
- pnpm 默认拦截依赖的构建脚本，首次会失败 —— `dsh` 会打印需要放行的确切键，把它加进 `~/.dsh/profiles/desktop/pnpm-workspace.yaml` 的 `allowBuilds` 下，再重跑同一条命令即可。
- 需要本机有 git、pnpm 与网络。

### 二、装 Release 附件（离线可用）

**第 1 步**：从 [Releases](https://github.com/kilo-s/dsh-rank-scan/releases) 下载最新的 `*.tgz`。
**第 2 步**：**完全退出 DSH 桌面版**，然后：

```powershell
pwsh -File scripts\install.ps1 -Spec "<刚下载的 tgz 的完整路径>"
```

macOS / Linux：`bash scripts/install.sh desktop <tgz 路径>`。

想自己从源码构建、或了解为什么仓库里不放 `lib/`，见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

**验证**：重开 DSH 后左侧栏会话列表下方应出现「扫榜」入口；或访问 `http://127.0.0.1:19387/api/rank-scan/health`，返回 `{ok:true,...}` 即通。

**更新**：重跑上面任一条安装命令即可（链接直装会取最新 main）。装了 [dsh-market](https://github.com/dsh-market/dsh-market) 的话，面板「抓什么」页底部有版本区，可就地检查并一键更新（该路径以 npm 上的包为目标）。

**卸载**：`pwsh -File scripts\uninstall.ps1`（macOS / Linux：`bash scripts/uninstall.sh`）。卸载会清掉插件、路由残留与 junction，但**保留数据目录** —— 想彻底清理请自行删除它。

## 能做什么

| 能力 | 说明 |
|---|---|
| 五站采集 | **起点**签约榜 × 15 分类（默认轻小说；其余分类勾了才抓，移动端口径）· **起点图**首订榜 / 三江·推荐效果（周）· **刺猬猫**点击榜(周) / 新书榜(周) / 首订(约) · **番茄**男频新书榜 × 8 分类 · **菠萝包**新书榜(点击) / 轻小说热榜(周) / VIP 热销榜(周) |
| 派生榜 | 番茄「在读周榜（候选池内）」由已落盘快照本地计算，**不发请求**；不足 7 天标 `N/7` |
| 变化集 | 新入榜 / 回榜 / 上升 / 下降 / 退榜分开列；在榜天数；基准日；无基准时一律「—」，**不报 0** |
| 周期榜换期 | 起点图三江当期无数据自动回退上一期（最多 2 期）；**换期当天变化列判不可比**并标注「新期」 |
| 状态五态 | `ok` / `missing` / `stale` / `login_required` / `truncated`；**缺失一律 `null`，绝不补 0** |
| 按需补全 | 起点精确字数与收藏、番茄干净书名/作者、刺猬猫与菠萝包字数与收藏；结果就地覆盖当天快照，可重复补（幂等） |
| 落盘纪律 | 按数据日期落快照，原子写、同日覆盖即幂等；精简索引 / 保留清理 / 导出 |
| 定时扫描 | 按站分时，**默认开启**，安装当天不跑；面板可改时刻与开关，**改动跨重载保留** |
| 面板记忆 | 浮窗位置与尺寸、收起状态、当前页签、正在看哪天，都在刷新后恢复 |
| 版本与更新 | 面板显示当前版本；装了 dsh-market 可一键更新，没装则只读（不硬赌能力） |
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

跨源请求一律 403：`/api/rank-scan/*` 在宿主侧不做鉴权，插件自己加了来源闸。

## 数据与隐私

- **只读**站点公开榜单与书页；**不登录、不抓正文、不推送**任何地方。
- 采集纪律：限速 **1s/请求**、每榜**每日 1 次**、失败重试 **≤2** 次。
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

1. DSH 启动日志里搜 `did not activate` 与 `pending (waiting for services`：前者 = 面板 bundle 没加载成功，后者 = 缺 timer / webServer 服务；
2. 访问 `/api/rank-scan/health`：能返回 JSON ⇒ host 侧活着，问题在面板；连不上 ⇒ 插件没装上；
3. 重装一次：`pwsh -File scripts\install.ps1 -Spec "<tgz>"`。

**面板点不开 / 点了没反应**：先确认点的是哪颗按钮 —— DSH 的侧栏会把插件入口包进它自己的一行 `<button>`，我们的入口嵌在里面（DOM 里因此有两颗文本相同的 button，外层那颗不是我们的 handler）。

**某个榜显示 `missing` / 一列都是「—」**：先看是不是数据源本身就没有这个字段（例如站点榜单页不给字数与收藏，需要点「补全」进书页取）；本插件对缺失一律显示「—」，不会编造 0。

**站点改版**：先跑夹具测试（`node tests/qidian-fixture.test.mjs` 等），再看 `tests/fixtures/` 里的响应快照哪里变了。

## 开发

构建、测试、设计约束、目录结构、面板与宿主路由结构、验收闸门与依赖纪律，见 **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**；版本变更历史见 **[CHANGELOG.md](CHANGELOG.md)**。

## 许可证

BSD-3-Clause，见 [LICENSE](LICENSE)。
