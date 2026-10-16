# 开发与构建

> 面向改这个插件的人。使用者请回 [README.md](../README.md)。

## 目录结构

```text
package.json          dsh.bundle.patch → cordis.patch.yml；dsh.client.platform = web；零运行时依赖
cordis.patch.yml      装配入口（最小 insert 补丁）
src/index.ts          host 侧：状态迁移、路由、定时、扫描编排、按需补全
src/scan/*.ts         纯逻辑（可单测）：derive 派生榜 / diff 变化集与跨期保护 / view 列与排序口径 /
                      schedule 定时判据 / store 落盘 / files 复制与导出 / fontmap 字体映射 /
                      update 与 update-check 更新通道 / guard 来源与日期校验 / bounded-fetch 超时
src/sites/*.ts        站点适配器：qidian-mobile / qidiantu / ciweimao / fanqie / sfacg
client/client.js      面板 bundle 的**源**（手写，不经 tsc；只 require('react')）
lib/                  tsc 产物 + 复制过来的面板 bundle（**不进仓库**：注释会被复制、sourcemap 带绝对路径）
tests/*.test.mjs      离线测试（node:test，零依赖，不联网）
tests/fixtures/       站点响应快照，供解析器回归
scripts/              构建、测试、安装、卸载、验收闸门
```

## 构建

```bash
npm install        # 只为拿 typescript / @types/node（运行期零依赖；装完会自动跑一次 prepare=构建）
npm run build      # = node scripts/build.mjs：tsc 编 host + 把 client/client.js 复制成 lib/client.js
```

- 构建入口**必须是纯 Node**（`scripts/build.mjs`）：Windows 上没有可用的 bash，而 git 直装（`dsh plugin add github:…`）要靠 package.json 的 `prepare` 在**用户机器上**跑构建。
- `prepare` 同时意味着「本地 npm install 会自动构建一次」；`prepack` 保证打包前一定是最新产物。

- `lib/` **不入库**：编译产物会把源码注释复制一份，sourcemap 还带构建机的绝对路径；同时产物与源码会各自漂移。
- **面板 bundle 的源是 `client/client.js`**（入库），构建时被**复制**到 `lib/client.js` —— 它是手写的，不编译、不打包；所以「clone → `npm run build`」能产出与发布包一致的 `lib/`。
- 代价是**不能 clone 仓库直装**（只有源码，宿主加载会 `did not activate`）。对外分发只有两种形态：Release 附件里的 tgz（`.github/workflows/build.yml` 打 tag 时从源码构建）与 `npm pack`。
- 产出包自查：`tar -tzf <tgz>` 必须能看到 `package/lib/index.js`、`package/lib/client.js`、`package/cordis.patch.yml`。

## 测试

```bash
pwsh -File scripts/test-local.ps1     # 逐个文件跑（node --test 会 spawn 子进程，某些沙箱拒 EPERM）
node tests/diff.test.mjs              # 单个文件
```

测试里的时间戳是 **+08:00 语义**（「数据日期」取本地自然日），运行环境假定 `Asia/Shanghai` —— CI 用 `env: TZ: Asia/Shanghai` 固定；在别的时区跑要自己设，否则「凌晨 01:30 也算当天」这类断言会失败。

全部是 `node:test` 离线测试，不联网：五态判定 / 幂等覆盖 / 取消 · 适配器端到端与夹具解析 · 派生榜自然周边界 · 变化集与跨期保护 · 列口径与排序 · 定时判据与开关迁移 · 书签原子写 · 客户端 bundle 解析。

新增测试时：把它放进 `tests/`，文件名以 `.test.mjs` 结尾即可被两个闸门收集（`scripts/test-local.ps1` 与 `scripts/acceptance.ps1`）。

**夹具纪律**：`tests/fixtures/` 只放**自动裁剪过的最小夹具** —— 每个文件只保留解析器真正读取的结构，裁剪后解析结果与原响应逐字节一致（所以断言的仍是真实页面结构）。整页原文与「全保真回归」在开发机私有层（`run-full-fixtures.ps1`：临时覆盖整页快照跑全量测试，跑完 `git checkout` 还原）。**不要把整页快照搬回仓库**。

## 设计约束（改代码前先读）

- **词汇统一**：站（站点）/ 榜（榜单）/ 快照（某榜某数据日的行集）/ 数据日期 / 变化集（与上一数据日的差异）/ 抓取集（抓哪些榜）/ 显示集 / 状态五态（`ok` `missing` `stale` `login_required` `truncated`）。
- **缺失一律 `null`，绝不补 0**；日期取本地自然日（**忌 `toISOString()`**：北京时间凌晨会差一天）。
- **采集纪律**：限速 1s/请求、每榜每日 1 次、失败重试 ≤2、原子写、同日覆盖。
- **不要用 `fs.cpSync` 复制目录**：递归复制目录会 EIO Access is denied，导出会直接失败；一律逐文件 `copyFileSync`（见 `scan/files.ts` 的 `copyDirDeep`）。
- **唯一测试 seam** = `runScan({ sites, clock, store, budget, enrich })`：站点 / 时钟 / 存储 / 预算全部注入，纯逻辑不许直接读全局状态。
- 数据目录与工作区无关；插件不写工作区内文件。

## 面板与宿主路由

面板是**手写 bundle**（源在 `client/client.js`，构建复制为 `lib/client.js`；`window.__ModuleLoader__.load({ id, factory })` 形态），注册到 `shell.overlay`，入口挂在 `sidebar.panellist`。宿主侧路由用 `ctx.inject(['webServer'], ...)` 注册 `/api/rank-scan` 前缀。

三条踩过的坑：

- ⚠️ **路由前缀不得带尾斜杠**。宿主 `match()` 的规则是 `pathname === prefix || pathname.startsWith(prefix + '/')`，带尾斜杠的 `/api/rank-scan/` 永远匹配不到 `/api/rank-scan/overview`（会被更短的 `/api` 抢走，症状是全站 404）。必须注册不带尾斜杠的前缀，handler 内再归一化尾斜杠。
- ⚠️ **webServer 要晚绑定**：运行时注入的实例上直取 `ctx.webServer` 拿不到，要用 `ctx.inject(['webServer'], ...)`。拿不到时插件半激活：面板仍在，但路由不注册，并在诊断栏标出缺哪个能力。
- ⚠️ **客户端改动后要刷新 GUI 页面**才生效（host 侧改动用插件热重载即可）。改完**必须**跑 `tests/client-bundle.test.mjs`：`node --check` 不会真正解析这种模板字符串 bundle，语法错误会让整个入口消失（宿主日志：`import failed` + `did not activate`）。

## 装配入口

`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`（最小 insert 补丁）；`dsh.client.platform = web`，`exports` 必须有 `./client`。装配相关断言在验收闸门的「装配闸」三组里。

## 依赖纪律（零运行时依赖）

本插件 host 侧只允许 `node:` 内建与相对路径 import（`package.json` 里没有 `dependencies`，也不声明 `peerDependencies`），面板只 `require('react')`。理由：某些受限环境禁止 symlink，`npm install` 的依赖链装不上，带依赖的插件直接构建失败。

推论：工具类能力不许 import 宿主的 `dsh-tools` / `schemastery`；面板 bundle 手写，不引 tsdown。

## 验收闸门

```bash
pwsh -File scripts/acceptance.ps1 -SkipLive   # 离线：结构 + 单测 + 各类闸门
pwsh -File scripts/acceptance.ps1             # 加上在线探针（需要插件已注入）
```

分五组：**不连累本体**（回调兜底 / 入参校验 / 扫描锁 / 超时）· **轻量**（定时惰性接线 / 占用统计走缓存 / 收起不轮询）· **坏了也没事**（书签原子写与备份恢复）· **轻量/轻依赖/易安装 闸门**（依赖闸 / 装配闸 / 轻量闸 / 分发闸 / 迁移闸 / 通道闸 / **公开面闸**）· **周期榜换期**与**版本一键更新**。

**公开面闸**（本仓库是给别人看的）在提交前必须全绿：编译产物不进索引 · 无个人绝对路径 · 无内部人称与所有权称呼 · 公开面引用的 `docs/*.png` 与 `docs/*.md` 必须存在（防死链）。

## 发布

1. 改 `package.json` 的版本位；
2. 双闸门全绿（`scripts/test-local.ps1` + `scripts/acceptance.ps1`）；
3. 打 tag（`v<version>`）并推送 —— `.github/workflows/build.yml` 会从源码构建、跑离线自测、校验包内是否有 `lib/index.js` / `lib/client.js` / `cordis.patch.yml`，然后挂到同名 Release；
4. 本地 `npm pack` 前先**释放文件认领**（或删掉根目录的 `README*.dshclaim` / `CHANGELOG*.dshclaim`）—— npm 会无条件收录 `README*`/`CHANGELOG*`/`LICENSE*`，认领标记会被一起打进包；CI 从干净检出构建，不受影响。
5. 发布说明写「安装：先完全退出 DSH，再执行 `dsh plugin --profile desktop add <附件 tgz 的本地路径>` 或解压后跑 `scripts/install.ps1`」。

包名与分发渠道的决定（含改名与 scope 注意事项）记在开发机的私有文档里，不入库。
