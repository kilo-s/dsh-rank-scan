# 发布与分发（PUBLISHING）

> 面向维护者。**每次发版照这份走**，不要靠记忆。
> 分发决定（2026-10-16，维护者拍板）：**走 npm**（同时保留 GitHub Release + tgz 作为备选渠道）。

## 0. 一页速览

```
① 改版本位 → ② 双闸门绿 → ③ npm pack（产物带 lib/）→ ④ git tag + Release 挂 tgz → ⑤ npm publish → ⑥ 打 dsh-plugin topic
```

## 1. 仓库只放源码；可分发的包由 CI 构建（**最容易踩死的一条**）

`lib/` **故意不进仓库**（`.gitignore` 忽略它）。原因有两条，都是实测出来的：

1. 编译产物会把**源码注释原样复制一份**，并且 `*.js.map` 里带**构建机的绝对路径** ⇒ 等于把内部注释
   和本机信息一起公开；
2. 产物与源码会各自漂移（改了 src 忘了重建，仓库里的 `lib/` 就是旧的）。

**代价**：不能 `dsh plugin add <本仓库URL>` 直接装（那样只有源码，插件加载会失败：宿主日志 `did not activate`）。
所以对外分发只有两种形态：

- **Release 附件里的 tgz**（主推）：由 `.github/workflows/build.yml` 在**打 tag 时自动构建并挂上**，
  包里含 `lib/` + `cordis.patch.yml`；用户下载后跑 `scripts/install.ps1 -Spec "<tgz>"`；
- **npm**（可选，见 §3 改名步骤）：`npm publish` 上传的包含 `lib/`（`prepack` 会自动构建）。

README 必须写明「**不要用仓库 URL 直接装**」，并指向 Releases。
本地要构建时：`npm install && npx tsc -p tsconfig.json`（`scripts/build.sh` 亦可，它按 DSH_CHECKOUT/PATH 找 tsc）。

### ★ 公开面红线（2026-10-16 立，踩过两次）

这个仓库是给**使用者**看的。公开面文本（README / CHANGELOG / 仓库内 docs）里**不许出现**：

| 禁项 | 为什么 | 正确写法 |
|---|---|---|
| `本机` / `这台机器` / 沙箱细节 | 作者本机的事实，读者没有 | 写「某些环境」「Windows 下」或直接去掉 |
| `维护者` / `属主` / `我` / `你` | 这是私下对话的人称，外人不知道指谁 | 去掉人称，直接陈述事实与做法 |
| `实测` + 当天具体数字 | 那是调试现场记录，不是文档 | 需要保留就写进 CHANGELOG 一行结论 |
| 变更日志式的「按反馈修复」小节 | 读者要的是**怎么用**，不是我们的开发过程 | 压成 CHANGELOG 一行；过程细节留本机 |
| 指向仓库外文档的相对路径（如 `docs/handoff-*.md`） | 读者点开是 404 | 改成「见提交记录」或删掉 |
| 引用已删除的文件（截图等） | 死链 | 要么补回文件，要么去掉引用 |

**判据一句话**：这句话回答的是「我们当时怎么决定的」⇒ 进 CHANGELOG / 本机；
回答的是「装上以后怎么用、会看到什么」⇒ 才留在 README。

发布前用 `scripts/acceptance.ps1` 的「**公开面闸**」四组探针自检（lib 不进索引 / 无个人绝对路径 / 无内部称呼 / .gitignore 仍忽略 lib）。

## 2. 发布检查清单（每条必须能指出证据）

| # | 动作 | 完成证据（必须能指出来） |
|---|---|---|
| 1 | 清理中间产物 | 仓库里不出现 `build.log`、`*.dshclaim`、`*.dshpending/` |
| 2 | `LICENSE` 与 `package.json` 的 license 字段一致 | 两个文件都在，字段 = BSD-3-Clause |
| 3 | 版本位升级 | `package.json` 的 version 改动可见 |
| 4 | README 顶部写清装法 | 出现「npm 一条命令」+「Release tgz」两条路径，并带「别 clone 源码」警告 |
| 5 | 双闸门通过 | `scripts/test-local.ps1` 全绿；`scripts/acceptance.ps1` 全 PASS |
| 6 | `npm pack` 产物自查 | tgz ≤ 400 KB；`tar -tf` 能看到 `package/lib/index.js` 与 `package/lib/client.js` |
| 7 | 首次提交 + 推送 | 远端仓库页显示首个 commit；本地 `git status` 干净 |
| 8 | tag + Release | tag 名 = `v<version>`；Release 附件里有同名 tgz，链接可打开 |
| 9 | npm publish | `npm view <包名> version` 等于刚发的版本 |
| 10 | （可选）市场收录 | 仓库带 `dsh-plugin` topic；隔天在 `https://dsh-market.com/manifest/plugins.json` 里能搜到包名 |

## 3. 走 npm 前必须做的一次性改名

当前包名是 **`@dsh-external/dsh-rank-scan`**——`@dsh-external` **不是我们的 scope**，不能用于公开发布。发 npm 前：

1. `package.json` 的 `name` 改成裸名 **`dsh-rank-scan`**（最简单；要先在 npm 上确认没被占用：`npm view dsh-rank-scan`）；
2. **删掉 `"private": true`**（否则 npm 拒绝发布）；
3. ⚠ **改名会打断本机现有安装的解析链**：本机 desktop profile 里是以 `@dsh-external/dsh-rank-scan` 这个包名
   建立 junction/装配的。改名后**必须重新装配**（卸载旧名 → 装新名 → 重启 DSH）并重新验证面板与路由；
4. 所以改名这一步**放在真正发版那一批做**，不要和别的改动混在一起。

## 4. 版本检查 / 一键更新（面板按钮）的现状与前提

面板的「版本 + 一键更新」走 **dsh-market 的公开更新 API v1**（`GET /dsh-market/api/v1/capabilities`、
`…/updates`、`POST …/updates`、`…/operations`）。三条硬约束：

1. 状态是 **beta** ⇒ 必须先探测能力，探测不到就**只读降级**（只显示当前版本），不许硬赌；
2. 变更请求必须**同源**（面板在 DSH 页面里跑，天然满足）；
3. **不许自己发明进程控制路径**——重启只能由宿主/市场发起；`restart.supported` 为 false（桌面版/被监管宿主）
   时客户端**必须隐藏重启按钮**，只能提示用户自己重启。

### 已落地形态（2026-10-16）

| 位置 | 内容 |
|---|---|
| 面板 | 「抓什么」页顶部「版本」区：显示 `name v版本` + 一句话状态 + **更新按钮**（五态文案）+「重新检查」 |
| host 路由 | `GET /api/rank-scan/version`（读包根 package.json，走 `import.meta.url`）、`GET /api/rank-scan/update-check`、`POST /api/rank-scan/update`、`POST /api/rank-scan/update-restart` |
| 转发纪律 | 只用市场**公开**的 v1 API；`restart.supported=false`（桌面/被监管宿主）⇒ 明确 501 并让用户自己重启；**绝不 spawn 包管理器、绝不自造进程控制** |
| 超时 | 每次外部调用都带 `AbortSignal.timeout`（4~8s）⇒ 探不到就是「查不到」，绝不挂住面板 |

**前提：用户侧也要装 `dshmarket`，且本插件通过 npm 安装**——市场的更新能力以 npm 包为目标；
本机的 `link:` 本地目录 / tgz 安装，市场查不出来也更新不了。因此面板在本机（link/tgz 安装）会
显示「当前版本」但不出更新按钮，这是**预期行为**，不是 bug。

判定逻辑集中在 `src/scan/update-check.ts`（纯函数、零依赖、单测覆盖）：
- `compareVersions`：版本比较（含预发布；拿不准判相等，**绝不给降级按钮**）；
- `updateAvailability`：无提供方 / 提供方不支持 / 可用 三态；
- `planUpdateCheck`：五态状态机 + 只认宿主回报的 `refreshRequired` / `restartRequired`；
- `describeCheck`：面板一句话文案。

## 5. 仍未拍板的口径（发版前要收掉）

1. ~~**定时默认口径**~~ ✅ **2026-10-16 维护者拍板并落地：默认开、用户可关、重载保留**。
   做法：删掉那条会翻开关的 v2 迁移（`bindTimer` 里现在**没有任何**写 `timerEnabled` 的语句），
   默认值由 `defaultState` 给出（`timerEnabled: true`）；唯一能改这个键的是面板 `POST /timer`（按用户显式布尔写盘）。
   升级上来的老配置：文件里已存过就沿用，没存过就按新默认「开」。安装当天仍不自动跑（`installedToday`）。
   闸门锚点：`开关-1 / 1b / 2 / 3`。
2. **各站刷新时刻**是经验值，未实测（做 3 天双时刻探测需要维护者批准额外请求）。
3. **菠萝包「评分」**不补全（榜页只有前 2 名有值），是否在面板标注口径由维护者定。
4. **卸载 .sh 与 `dsh plugin add` 真装配**都还没实测（都要先完全退出桌面版）。
