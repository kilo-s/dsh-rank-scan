/**
 * dsh-rank-scan — 扫榜插件（host 侧）。
 * 形态：hybrid（定时 + HTTP 路由 + 面板）。零运行时依赖（不 import cordis/dsh-tools/schemastery）。
 * ★ 本插件**没有注册任何 DSH 工具**（曾经注释里列的 rank_scan/rank_diff/… 是模板期残留，实际不存在）：
 *   对外能力只有 /api/rank-scan/* 这些 HTTP 路由 + 面板 UI。
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { localDate, runScan } from './scan/run.js'
import type { ScanRecord } from './scan/types.js'
import { requestAllowed } from './scan/guard.js'
import { FileStore } from './scan/store.js'
import { makeQidianMobileSite } from './sites/qidian-mobile.js'
import { makeQidiantuSite } from './sites/qidiantu.js'
import { makeCiweimaoSite } from './sites/ciweimao.js'
import { makeFanqieSite } from './sites/fanqie.js'
import { authorFromBookTitle, makeSfacgSite, SFACG_BOARDS } from './sites/sfacg.js'
import { CIWEIMAO_BOARDS, CIWEIMAO_BUY_URL } from './sites/ciweimao.js'
import { FANQIE_MALE } from './sites/fanqie.js'
import { CATEGORIES as QIDIAN_CATEGORIES } from './sites/qidian-mobile.js'
import { QIDIANTU_BOARDS, periodStartOf } from './sites/qidiantu.js'
import { deriveFanqieViews, poolDateOf } from './scan/derive.js'
import { decodePua, hasPua, learnPair, loadFontMap, saveFontMap } from './scan/fontmap.js'
import { applyColumnPolicy, batchKeyOf, batchKindOf, batchLabelOf, boardMeta, columnsFor, compareDesc, defaultSortFor, defaultSortKeyFor, enrichAttemptPolicy, enrichMissingCount, groupBySite, groupChanges, isBatchBoard, isEnrichableBoard, saleRangeOf, shouldShowDays, usesRankDelta, withFanqieCat } from './scan/view.js'
import { BookmarkService, BookmarkStore } from './scan/bookmark.js'
import { displayLabel, extractTags, parseBookInput, urlFor, type SiteId } from './scan/bookmark-parse.js'
import { decodeIfPua } from './scan/fontmap.js'
import { addDays, computeBoardDiff, daysOnBoard, guardCrossPeriod, jitterForBoard } from './scan/diff.js'
import { boardDayState, mergeDayIndex, mergeSlimBoards, previousTrustedDate, revisionDigest, type DayIndex, type DayUpdate, type SnapshotStat } from './scan/daily.js'
import { judgeFreshness, judgeSwap, periodKeyFromRows } from './scan/freshness.js'
import { boundedFetch } from './scan/bounded-fetch.js'
import { minRequestIntervalMs, setMinRequestIntervalMs as applyRequestInterval } from './scan/rate-limit.js'
/**
 * ★ 2026-10-16：更新链路。
 *   - 纯判定在 scan/update-check.ts（版本比较 / 能力三态 / 五态状态机，全部单测覆盖）；
 *   - 碰网络的薄层在 scan/update.ts（探测 dsh-market、查 npm registry、归一化操作终态）；
 *   - 这里只做路由粘合，且**所有外部调用都有超时**，失败退化成「查不到」而不是 5xx。
 * 纪律：本插件**不实现安装与重启**，只转发 dsh-market 的公开更新 API（桌面/被监管宿主由它裁决）。
 */
import { readOwnVersion, probeMarket, fetchNpmLatest, normalizeOperation, buildUpdateView } from './scan/update.js'
import {
  assertDataDate,
  dirSize,
  exportRange,
  historyFor,
  listDataDates,
  listSlim,
  normalizeRetention,
  previousDataDate,
  readSlim,
  runRetention,
  sweepTmp,
  writeReport,
  writeSlim,
} from './scan/files.js'
import { DEFAULT_FALLBACK_TIME, DEFAULT_SITE_TIMES, hmOf, planSiteRuns, SITE_ORDER, siteOfBoard, timeReached, validTime } from './scan/schedule.js'
import { cacheStats, cachedBook, clearCache, putCachedBooks } from './scan/qidian-cache.js'
import { assignCachedStats, cacheStats as bookCacheStats, cachedEntry, clearCache as clearBookCache, putEntries } from './scan/book-cache.js'

interface PluginCtx {
  tools: { register(tool: any): unknown }
  setInterval?(fn: () => void, ms: number): any
  effect?(setup: () => () => void): void
  /** cordis 依赖光纤：服务晚绑定（webServer 在运行时注入的实例上常常此时还不可见） */
  inject?(deps: string[], cb: (scope: any) => void): void
  webServer?: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: any, res: any) => void | Promise<void>
    }): () => void
  }
  logger?: { info?(msg: string): void }
}

export const name = 'dsh-rank-scan'
/**
 * ★ 票 24：**不写硬注入**。写进 inject 的服务只要缺失或改名，cordis 就让整个插件停在 pending，
 * 面板与路由一起消失（宿主只会打一行 "pending (waiting for services: ...)"）。本插件对这三个服务的态度：
 *   - `tools`：从未注册过任何工具 ⇒ 直接删掉；
 *   - `webServer` / `timer`：apply 时直取 + `ctx.inject` 晚绑定（见文件末尾），拿不到就**半激活** ——
 *     面板照常打开，由概览诊断栏告诉你缺哪个能力。
 */
/**
 * ★ 票 24：只声明**没有它就等于没有这个插件**的服务。
 *   实验记录（2026-10-16 实测，注入器判据 = `hasActiveEntry()`，即 loader 里该 entry 的 fiber 是否 active）：
 *     - `['tools','timer','webServer']`（原始）⇒ host ✓
 *     - `['timer','webServer']`（去掉从未使用的 tools）⇒ host ✓
 *     - `['webServer']` ⇒ host ✗（两次复现）｜`[]` ⇒ host ✗｜**完全不导出 inject** ⇒ host ✗
 *   ⇒ 结论（暂时）：本宿主/装载器上「少声明到只剩一个或零个服务」会让 entry 落成 [failed]，
 *     所以**只能做到把 `tools` 摘掉**这一步；`timer`/`webServer` 仍是硬声明。
 *   ⚠ 残留风险（票 24 未完成部分）：若将来 DSH 改名/移除 `timer` 或 `webServer`，本插件会 pending
 *     （宿主日志会写 "pending (waiting for services: ...)"）。晚绑定代码仍在，等宿主行为查明后再动。
 */
export const inject: string[] = ['timer', 'webServer']

const pad2 = (n: number) => String(n).padStart(2, '0')

function defaultState() {
  return {
    scanTime: '01:30',
    /**
     * ★ 2026-10-16：**按站分时抓取**（允许自定时刻）。scanTime 退化为兜底时刻。
     * 每个站放它自己刷新点之后：抓早了会把「昨天那版」记在今天，变化列出现假持平。
     */
    siteTimes: { ...DEFAULT_SITE_TIMES } as Record<string, string>,
    fallbackTime: DEFAULT_FALLBACK_TIME,
    /** 每站最近一次定时跑过的数据日（跨重启有效，防重复跑） */
    siteLastRun: {} as Record<string, string>,
  /** ★ 2026-10-17：每站**定时**那次跑成功的时刻（ISO）。siteLastRun 只有日期，面板要显示「定时 08:30」 */
  siteLastTimerAt: {} as Record<string, string>,
    /** 每个榜最近一次扫描（含手动）：面板可显示「这个榜上次什么时候抓的」 */
    boardLastScan: {} as Record<string, { date: string; at: string; outcome: string }>,
    /**
     * ★ 2026-10-16（既定口径，最终）：**定时默认【开】；用户可关；重载保留用户的选择**。
     *   - 新安装 = 开（但安装当天不自动跑，见 checkTimer 的 installedToday 分支）；
     *   - 用户关掉后，config.json 里的 false 会一直生效 —— **任何迁移都不许再写 timerEnabled**；
     *   - 升级上来的老配置：文件里已经有值就沿用，没有值（老版本没存过这个字段）则按新默认 = 开。
     */
    timerEnabled: true,
    /** 首次安装的数据日（='legacy' 表示升级上来的老配置） */
    installedAt: localDate(new Date()),
    // 定时扫描的落盘记录（跨重启有效，防「重启即重扫」；见 checkTimer 的注释）
    lastTimerRun: null as string | null,
    lastTimerRunAt: null as string | null,
    lastTimerState: null as string | null,
    lastTimerNote: null as string | null,
    timerSchemaV: 2,
    retentionDays: 180,
    maxRequests: 600,
    /**
     * 起点书页补全（收藏/精确字数）总开关 —— **默认关**（使用者 2026-10-15 口径）。
     * 起点收藏只存在于作品页（约 103 KB/本），榜页永远给不了；勾上之后靠 state/qidian-book-cache.json
     * 的 TTL 缓存跳过重复的书，只有「新入榜/缓存过期」的真去打请求。见 postScanEnrich 与 /qidianEnrich。
     */
    qidianEnrich: false,
    // 抓取集（冻结口径）：起点签约×轻小说 + 番茄男频新书榜 8 分类 + 起点图(首订/三江)
    //   + 刺猬猫(点击周/新书周/首订约) + 菠萝包(新书榜点击/轻小说热榜周/VIP热销榜)
    boards: [
      'qidian.sign.cat12',
      'qidiantu.shouding',
      'qidiantu.sanjiang',
      // 番茄 8 分类 = BB 侧同一套（novel-stats/collector/fanqie-library.mjs CATS）：热 4 + 冷 4
      'fanqie.m.new.262', 'fanqie.m.new.261', 'fanqie.m.new.1014', 'fanqie.m.new.257',
      'fanqie.m.new.1140', 'fanqie.m.new.258', 'fanqie.m.new.539', 'fanqie.m.new.1141',
      'ciweimao.no-vip-click.week', 'ciweimao.yp_new.week', 'ciweimao.buy.latest',
      'sfacg.new.click', 'sfacg.hot.week', 'sfacg.vip.week',
    ],
    // 显示集：三江、首订(约)、VIP热销榜 **抓到但不默认显示**（概览里计入「隐藏 N 个榜」）
    display: [
      'qidian.sign.cat12',
      'qidiantu.shouding',
      // 番茄 8 分类 = BB 侧同一套（novel-stats/collector/fanqie-library.mjs CATS）：热 4 + 冷 4
      'fanqie.m.new.262', 'fanqie.m.new.261', 'fanqie.m.new.1014', 'fanqie.m.new.257',
      'fanqie.m.new.1140', 'fanqie.m.new.258', 'fanqie.m.new.539', 'fanqie.m.new.1141',
      'ciweimao.no-vip-click.week', 'ciweimao.yp_new.week',
      'sfacg.new.click', 'sfacg.hot.week',
      // 派生榜（在读周榜）默认就在抓取集里：它不发请求，但要在「抓什么」里可见/可勾
      'fanqie.derived.period',
    ],
    /**
     * 每个榜取多少条（面板可逐榜调）。
     * 既定口径（2026-10-15）：**番茄与刺猬猫默认 30**；
     * 起点移动端榜单单页就是 20 条（SSR 里 pageNum=1/总数 172，翻页接口在反爬挑战后面）⇒ 固定 20；
     * 菠萝包首页每 tab 固定 10 ⇒ 固定 10；起点图首订当日榜 20–35 条、三江整期 ⇒ 固定。
     */
    depths: {
      'fanqie.m.new.262': 30, 'fanqie.m.new.261': 30, 'fanqie.m.new.1014': 30, 'fanqie.m.new.257': 30,
      'fanqie.m.new.1140': 30, 'fanqie.m.new.258': 30, 'fanqie.m.new.539': 30, 'fanqie.m.new.1141': 30,
      'ciweimao.no-vip-click.week': 30, 'ciweimao.yp_new.week': 30,
    } as Record<string, number>,
    filters: { excludeDerivative: true, wordsMin: 0, wordsMax: 0, topN: 0, onlyChanged: true },
    sortBy: 'rank',
    columns: ['rank', 'delta', 'title', 'author', 'cat', 'words', 'collect', 'days'],
    presets: { 日常: { boards: ['qidian.sign.cat12'], display: ['qidian.sign.cat12'] } },
    activePreset: '日常',
    /**
     * ★ 2026-10-16（补全持久化）：**待补全榜**（键 = boardId，值 = { date, tried }）。
     * 由来：抓榜一榜就把「裸快照」写盘，补全（进书页、1s/本）在写盘之后才跑 —— 补全被取消/
     * 超时/重启打断时，盘上就永久留下裸行，而重启/重载既不补抓也不补全（enrichIncomplete 是死标记）。
     * 现在把「还缺补全字段的榜」记进 state（带数据日期），定时器按 tick 续跑，直到补齐或当日放弃。
     * 注意：续跑**只补字段、不重抓榜页** ⇒ 仍满足「每榜每日 1 次」。
     */
    enrichPending: {} as Record<string, { date: string; tried: number }>,
    /**
     * ★ 2026-10-17（补全移出阻塞路径）：后台补全工人的进度。
     * 抓榜只花 71 秒，补全却要 ~5 分钟（1 请求/秒的硬纪律）——把它从 /scan 的等待路径里摘出来，
     * 抓完榜立刻落盘返回，补全在后台逐榜跑；面板按这里的字段显示「补全中 N/M」。
     */
    enrichRun: null as null | { startedAt: string; done: number; total: number; active: boolean; note: string },
  }
}

function readJson(path: string, fallback: any): any {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

function writeJson(path: string, value: any): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, path)
}

const fmtBytes = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB')

/** 书签服务在 apply 内实例化（依赖数据目录）；此处声明供内部函数引用 */
let BOOKMARKS: BookmarkService | null = null

export function apply(ctx: PluginCtx, config: any): void {
  const cfg = config || {}
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const root = cfg.dataDir || join(dshHome, 'data', 'rank-scan')
  const statePath = join(root, 'state', 'config.json')
  const clock = { now: () => new Date() }
  /**
   * 书签：用户自己产生的数据（唯一一处），独立于快照与保留策略。
   * 存储 = 数据目录下 state/bookmarks.json（单文件 + 原子写 + 3 份轮转备份 + 软删除）。
   * 词汇见 docs/rank-scan/CONTEXT.md：书签 / 我的书签 / 书签夹 / 备注；**不要**用「收藏」指代。
   */
  const bookmarkStore = new BookmarkStore(root)
  BOOKMARKS = new BookmarkService({ store: bookmarkStore, now: () => clock.now() })
  /**
   * 保留策略接线（ticket 22）：配置里 write 了 retentionDays，但 planCleanup/applyCleanup 从来没被调用过
   * ⇒ 快照实际上永远不会被清除（数据目录只涨不落）。这里在启动时按配置清一次，并记一条日志。
   * ★ 只删**数据日期目录**（快照与报告），**绝不触碰 state/**（配置、书签、书页缓存）。
   */
  try {
    const st0: any = readJson(statePath, {})
    // ★ 审计-2/39：启动路径原来直接取原始值 ⇒ config.json 手写成 0/负数会把**全部历史日期**删掉
    //   （面板接口有 7–3650 校验，启动路径没有）。这里过与面板同一个归一化函数。
    const keep = normalizeRetention(st0 ? st0.retentionDays : 180) ?? 180
    if (keep !== 'forever') {
      const today0 = clock.now().getFullYear() + '-' + String(clock.now().getMonth() + 1).padStart(2, '0') + '-' + String(clock.now().getDate()).padStart(2, '0')
      const res = runRetention(root, today0, keep)
      if (res.removed.length) {
        ctx.logger?.info?.('[' + name + '] 保留策略：清除 ' + res.removed.length + ' 个数据日期（' + res.removed.join('、') + '），释放 ' + Math.round(res.freed / 1024) + ' KB')
      }
    }
  } catch (e) {
    ctx.logger?.info?.('[' + name + '] 保留策略清理失败（不影响启动）：' + String(e).slice(0, 80))
  }
  // ★ 审计-2/39：清扫原子写中途留下的 *.tmp（旧实现只写不扫，失败残留永不清理）
  try {
    const tmpN = sweepTmp(root)
    if (tmpN) ctx.logger?.info?.('[' + name + '] 启动清理：删除 ' + tmpN + ' 个残留 .tmp')
  } catch { /* 清扫失败不影响启动 */ }
  // 启动清理：物理清除超过 30 天的软删除条目（幂等，失败不影响启动）
  try {
    const pruned = BOOKMARKS.pruneTrash()
    if (pruned > 0) ctx.logger?.info?.('[' + name + '] 书签回收站：已清除 ' + pruned + ' 条超过 30 天的记录')
  } catch (e) {
    ctx.logger?.info?.('[' + name + '] 书签启动清理失败（不影响启动）：' + String(e).slice(0, 80))
  }

  /**
   * ★ 抓取集里的派生榜 id 迁移（2026-10-15）：两个旧派生榜
   *   `fanqie.derived.delta`（在读涨幅榜）/ `fanqie.derived.week`（七日累计）
   *   已合并成一个**自然周**口径的 `fanqie.derived.period`（在读周榜）。
   *   旧 config.json 里还留着旧 id，不迁移的话「抓什么」会看不见新榜、保存时又把旧的写回去。
   */
  const DERIVED_LEGACY = ['fanqie.derived.delta', 'fanqie.derived.week']
  function migrateBoards(boards: unknown): string[] {
    const list = Array.isArray(boards) ? boards.map(String) : []
    const hadLegacy = list.some((b) => DERIVED_LEGACY.includes(b))
    const next = list.filter((b) => !DERIVED_LEGACY.includes(b))
    if (hadLegacy && !next.includes('fanqie.derived.period')) next.push('fanqie.derived.period')
    return next
  }

  const readState = () => {
    const s: any = { ...defaultState(), ...readJson(statePath, {}) }
    // 迁移是**幂等**的：只在看到旧 id 时才动，不动就原样返回（避免每次读都重写 config.json）
    const migrated = migrateBoards(s.boards)
    if (migrated.length !== (Array.isArray(s.boards) ? s.boards.length : 0) || migrated.some((b, i) => b !== (s.boards || [])[i])) {
      s.boards = migrated
      try { writeJson(statePath, s) } catch { /* 读路径上的写失败不该炸掉面板 */ }
    }
    return s
  }
  const writeState = (s: any) => writeJson(statePath, s)

  /** 按勾选的 boardId 前缀装配站点适配器（抓取集是 boardId 列表，站内细节由适配器管） */
  /** 没配过深度的榜按站取默认：番茄 / 刺猬猫 30（每页 10 ⇒ 3 页），其余由站点自身决定 */
  function defaultDepthFor(boardId: string): number {
    if (boardId.startsWith('fanqie.m.') || boardId.startsWith('ciweimao.')) return 30
    return 10
  }

  function sitesFor(boards: string[], depths: Record<string, number> = {}): any[] {
    const q = boards.filter((b) => b.startsWith('qidian.'))
    const qd = boards.filter((b) => b.startsWith('qidiantu.'))
    const cw = boards.filter((b) => b.startsWith('ciweimao.'))
    const fq = boards.filter((b) => b.startsWith('fanqie.') && !b.startsWith('fanqie.derived.'))
    const sc = boards.filter((b) => b.startsWith('sfacg.'))
    const out: any[] = []
    if (q.length) out.push(makeQidianMobileSite({ boardIds: q }))
    if (qd.length) out.push(makeQidiantuSite({ boards: qd }))
    if (cw.length) out.push(makeCiweimaoSite({ boards: cw, depthOf: (b: string) => depths[b] || defaultDepthFor(b) }))
    if (fq.length) {
      // 番茄 bookName/author 是私用区码点（字体反爬）⇒ 落盘前用学到的映射表解一次
      const map = loadFontMap(root)
      out.push(makeFanqieSite({
        boards: fq,
        depthOf: (b: string) => depths[b] || defaultDepthFor(b),
        decode: (s: string) => decodePua(s, map).text,
      }))
    }
    if (sc.length) out.push(makeSfacgSite({ boards: sc }))
    return out
  }

  /**
   * ★ 2026-10-17：站点集合的**测试 seam**（cfg.sitesFactory）。只给「按日期直查 / 修复」两条
   * 写盘路径用 —— 单测要能断言「内容日期对不上时一个字节都没写」，不能真连站点。
   */
  function serveSiteFor(boards: string[], depths: Record<string, number> = {}): any[] {
    return typeof cfg.sitesFactory === 'function' ? (cfg.sitesFactory as any)(boards, depths) : sitesFor(boards, depths)
  }

  /**
   * 扫描后补全：刺猬猫/菠萝包的**榜单页给不出字数/收藏**（刺猬猫完全没有，菠萝包只有前 2 名），
   * 必须进书页取。默认开（state.autoEnrich !== false），只在整站扫描后跑，单榜扫描不跑。
   * 5 个榜 ≈ 50 请求 × 1s（仍在 1s/请求 纪律内）
   */
  async function postScanEnrich(only?: string[]): Promise<any[] | null> {
    const st = readState()
    if (st.autoEnrich === false) return null
    /**
     * ★ 2026-10-16（按站分时）：只要**本次扫描范围内**的榜。
     * 以前是「整站扫描后补全全部站」——按站跑时会把别站的书页也抓一遍（白费请求）。
     */
    const inScope = (b: string) => !only || only.indexOf(b) >= 0
    // 番茄也补（字体反爬缺字）：已能从映射表解码的行会被 need 过滤掉，所以逐日越来越快
    const targets = (st.boards as string[]).filter((b) => inScope(b) && (b.startsWith('ciweimao.') || b.startsWith('sfacg.') || b.startsWith('fanqie.m.')))
    /**
     * ★ 2026-10-16（补全持久化）：一次扫描后的补全**目标榜序**——本轮真正跑过的榜排前面，
     *   然后是本轮没跑的其它榜。每榜的请求预算上限 = 剩余预算（治「最后一榜拿不到预算」）。
     *   剩下的榜由 state.enrichPending 记着，定时器 tick 续跑。
     */
    /** 单榜补全的请求上限：**剩余预算**（治「前面几榜把预算吃干、最后一榜拿不到」） */
    const PER_BOARD_ENRICH_CAP = 60
    const done: any[] = []
    let left = PER_BOARD_ENRICH_CAP * 4
    for (const b of targets) {
      if (left <= 0) { markEnrichPending(latestDataDate(), b); continue }
      try {
        const r: any = await enrichBoard(b, true, left)
        left = r && typeof r.requests === 'number' ? left - r.requests : left
        done.push({ boardId: b, ok: !!r.ok, filled: r.filled || 0, requests: r.requests || 0 })
      } catch (e) {
        done.push({ boardId: b, ok: false, error: String(e).slice(0, 60) })
      }
      // ★ 补全持久化：本轮跑完仍缺 ⇒ 记进待办（定时器 tick 会续跑；补齐的会被清掉）
      const snap: any = new FileStore(root).readSnapshot(latestDataDate(), b)
      if (snap && needsEnrichRows(b, snap.rows || []) > 0) markEnrichPending(latestDataDate(), b)
    }
    /**
     * 起点/起点图三江 单独一条通道（走书页缓存）：受 `state.qidianEnrich` 开关控制。
     * 使用者 2026-10-15：三江的**字数**只能从起点书页取（三江表里没有字数字段），所以并入这条通道：
     * 同一个开关管「起点 收藏/精确字数」+「三江 字数」，一次勾选两处受益。
     * 不塞进上面的 targets：这里的成本模型不同（每本书页 ~92 KB，靠缓存压请求数）。
     */
    if (st.qidianEnrich === true) {
      const qdBoards = (st.boards as string[]).filter((x) => inScope(x) && (x.startsWith('qidian.') || x.startsWith('qidiantu.')))
      for (const b of qdBoards) {
        try {
          // 三江一期本数少（实测 17 本）⇒ 预算给小一点，别把整轮扫描拖长
          const budget = b.startsWith('qidiantu.') ? 30 : QIDIAN_ENRICH_BUDGET
          const r: any = await qidianEnrichBoard(b, false, budget)
          done.push({ boardId: b, ok: !!r.ok, filled: r.fetched || 0, requests: r.requests || 0, cacheHit: r.cacheHit || 0 })
        } catch (e) {
          done.push({ boardId: b, ok: false, error: String(e).slice(0, 60) })
        }
        // ★ 补全持久化：起点/起点图三江同样记待办（补齐的行会被清掉）
        const snapQ: any = new FileStore(root).readSnapshot(latestDataDate(), b)
        if (snapQ && needsEnrichRows(b, snapQ.rows || []) > 0) markEnrichPending(latestDataDate(), b)
      }
    }
    return done
  }

  /**
   * ★ Spec E（2026-10-24）：**运行中那一轮**的扫描记录（只放内存，不落盘）。
   *   落盘 scan.json 只在整轮结束时写一次 ⇒ 旧实现里 overview 在扫描过程中永远读到「上一轮的 completed」，
   *   面板看不到 0/N → 1/N 的真实进度，定时扫描期间连「正在跑」都不知道。
   *   onProgress 每完成一个榜就把最新记录放进来；doScan 的 finally 立刻清空 ⇒ 不会残留假 running。
   */
  let activeScan: any = null

  async function doScan(trigger: 'manual' | 'timer', opts: any) {
    const st = readState()
    const store = new FileStore(root)
    const effectiveBoards = opts && opts.boards
      ? String(opts.boards).split(',').map((x: string) => x.trim()).filter(Boolean)
      : st.boards
    let rec: ScanRecord
    try {
      rec = await runScan({
        /**
         * ★ Spec E：走 serveSiteFor（与 /day、/repair 同一条测试 seam）。
         *   生产没有 cfg.sitesFactory 时原样回退 sitesFor，行为不变；
         *   有了它，单测才能用「可控延迟的隔离站点」验证 overview 在扫描中途读到真实进度。
         */
        sites: serveSiteFor(effectiveBoards, st.depths || {}),
        clock,
        store,
        trigger,
        boards: effectiveBoards,
        enrich: !!(opts && opts.enrich),
        retryNonOk: !!(opts && opts.retry),
        /** ★ 工作包 A：记录本批的范围（scan.json 是批次记录；当天状态在 day-index） */
        partial: !!(opts && (opts as any).partial),
        batchSite: opts && (opts as any).site ? String((opts as any).site) : null,
        betweenBoardsMs: 500,
        budget: { maxRequests: st.maxRequests || 600 },
        /** 只更新内存活跃记录；观察者抛错由 runScan 兜住，不会中断扫描 */
        onProgress: (r) => { activeScan = r },
      })
    } finally {
      // 成功/取消/抛错都必须清：残留会让面板一直显示「扫描中」并按运行态高频轮询
      activeScan = null
    }
    /**
     * ★ 2026-10-16（按站分时）：一次「部分扫描」（只跑一个站）**不能覆盖当天的全量产物**：
     * 精简索引/报告按 `<日期>-<站>` 落盘，全量扫的那份照旧叫 `<日期>`，两边都不丢。
     */
    const artId: string = opts && (opts as any).partial && (opts as any).site ? rec.dataDate + '-' + String((opts as any).site) : rec.dataDate
    /**
     * ★ 工作包 A（2026-10-22）：**唯一的新鲜度/可信度判定点**，取代原来互不相干的两段
     * （①「与上一数据日 key=value 全等 ⇒ 疑似未刷新」② 刺猬猫「交集 ≤2 ⇒ 换榜」）。三个动机：
     *   ① 名次榜 value 恒为 null ⇒ 旧签名退化成书号列表，细节数字（收藏/字数）不参与；
     *   ② 周期榜同一期本来就不变（刺猬猫首订约 issue 478 连两天）⇒ 误判陈旧并触发**整站**兜底补抓；
     *   ③ 判定只改内存记录 ⇒ 被拒的快照仍在展示/变化/书签里（体检 P1-C）。
     * 现在：逐榜向前找**上一次可信成功**（跨过缺日），按榜的更新节奏（日/周/期）判定；
     * 命中 ⇒ 打 <date>/<boardId>.untrusted.json（raw 保留、只隔离使用）+ 记进 day-index。
     */
    const batchIds = new Set(rec.batch?.boards || rec.boards.map((b) => b.boardId))
    const batchBoards = rec.boards.filter((b) => batchIds.has(b.boardId))
    const samePeriodBoards = new Set<string>()
    try {
      const flagged: any = {}
      const stS: any = readState()
      const flags: any = { ...(stS.staleFlag || {}) }
      for (const b of batchBoards) {
        if (b.status !== 'ok') continue
        const nx: any = store.readSnapshot(rec.dataDate, b.boardId)
        if (!nx || !(nx.rows || []).length) continue
        const prevD = previousBoardDate(b.boardId, rec.dataDate)
        const pd: any = prevD ? store.readSnapshot(prevD, b.boardId) : null
        const verdict = judgeFreshness({
          boardId: b.boardId,
          date: rec.dataDate,
          prevDate: prevD,
          currentRows: nx.rows || [],
          previousRows: pd ? (pd.rows || []) : null,
          currentPeriodKey: periodKeyFromRows(nx.rows || []),
          previousPeriodKey: pd ? periodKeyFromRows(pd.rows || []) : null,
        })
        /**
         * ★ 2026-10-25（换期 ≠ 换榜/降级）：换榜判据必须先问「是不是同一期」。
         *   刺猬猫首订每周整批换新（交集 0），旧判据把它当换榜/降级隔离 ⇒ 整榜长期不可见。
         *   现在跨期一律不判换榜（见 freshness.ts#judgeSwap）。
         */
        const swap = b.boardId.startsWith('ciweimao.')
          ? judgeSwap({ boardId: b.boardId, date: rec.dataDate, prevDate: prevD, currentRows: nx.rows || [], previousRows: pd ? (pd.rows || []) : null })
          : { swapped: false, samePeriod: null as boolean | null, reason: null as string | null }
        if (swap.swapped || verdict.verdict === 'suspected') {
          /**
           * ★ 2026-10-25（防永久锁安全阀）：基准只取「上次可信」⇒ 一旦某天判错，之后每天
           *   都拿同一份旧内容重判，永远不自愈（实测 10-24 起两天）。连续 3 个数据日都判
           *   不可信时，接受本次内容但**写明请人工核对**——宁可带警告显示，也不让整榜消失。
           */
          const priorDays = consecutiveUntrustedDays(b.boardId, rec.dataDate)
          if (priorDays >= 3) {
            try { store.clearUntrusted(rec.dataDate, b.boardId) } catch { /* 清标记失败不影响结果 */ }
            b.acceptedAfterRepeat = true
            b.reason = '连续 ' + priorDays + ' 天判不可信，已接受本次内容（请人工核对）'
            rec.warnings.push(b.boardId + '：' + b.reason)
            delete flags[b.boardId]
          } else {
            const reason = swap.swapped
              ? '疑似换榜/降级（同一期内与上次有效快照交集 ≤2）'
              : String(verdict.reason || '疑似未刷新')
            try { store.markUntrusted(rec.dataDate, b.boardId, { reason, at: new Date().toISOString(), by: trigger }) } catch { /* 标记失败仍按记录处理 */ }
            b.status = 'stale'
            b.untrusted = true
            b.reason = reason
            b.rows = []
            delete flags[b.boardId]
            if (!swap.swapped) flagged[b.boardId] = { date: rec.dataDate, prevDate: prevD, suspected: true }
          }
        } else {
          try { store.clearUntrusted(rec.dataDate, b.boardId) } catch { /* 清标记失败不影响结果 */ }
          delete flags[b.boardId]
          if (verdict.samePeriod) { b.samePeriod = true; samePeriodBoards.add(b.boardId) }
        }
      }
      /**
       * 适配器自己抛 StaleError 的榜（例如菠萝包判据）同样是「抓到但不可信」：
       * 若当天目录里残留了更早的快照（同日先成功后判 stale），必须一并隔离，不能让它继续被展示。
       */
      for (const b of batchBoards) {
        if (b.status !== 'stale' || b.untrusted === true) continue
        b.untrusted = true
        try { store.markUntrusted(rec.dataDate, b.boardId, { reason: String(b.reason || '适配器判为不可信'), at: new Date().toISOString(), by: trigger }) } catch { /* 标记失败仍按记录处理 */ }
      }
      // ★ 只把**真正可疑**的榜交回给兜底队列；「同一期未变化」不进 staleFlag（不再误触整站补抓）
      Object.assign(flags, flagged)
      stS.staleFlag = flags
      writeState(stS)
      const suspectBoards = Object.keys(flagged)
      if (suspectBoards.length) rec.warnings.push('以下榜的内容不可信（原始快照已保留，本次不展示、不参与变化）：' + suspectBoards.join('、'))
      if (samePeriodBoards.size) rec.warnings.push('同一期未变化（正常，不判陈旧）：' + Array.from(samePeriodBoards).join('、'))
    } catch (e) {
      rec.warnings.push('新鲜度判定失败（不影响抓取）：' + String(e).slice(0, 60))
    }
    // 每个榜的「上次扫描」落进 state（部分扫描时 scan.json 只留最后一次 ⇒ 面板要能逐榜查）
    try {
      const stB: any = readState()
      const bls: any = { ...(stB.boardLastScan || {}) }
      for (const b of batchBoards) bls[b.boardId] = { date: rec.dataDate, at: new Date().toISOString(), outcome: String(b.status), by: trigger }
      stB.boardLastScan = bls
      writeState(stB)
    } catch { /* 记不上不该影响扫描结果 */ }
    const snaps = new Map<string, any>()
    for (const b of batchBoards) {
      if (b.status !== 'ok') continue
      const s = store.readSnapshot(rec.dataDate, b.boardId)
      if (s) snaps.set(b.boardId, s)
    }
    // 派生榜不进扫描：如实说一句（否则以后看 scan.json 会以为「漏抓了一个榜」）
    try {
      const derivedInCapture = ((st.boards as string[]) || []).filter((b) => b.startsWith('fanqie.derived.'))
      if (derivedInCapture.length) {
        rec.warnings.push('派生榜不进扫描（本地按快照计算，0 请求）：' + derivedInCapture.join('、'))
        await store.writeScan(rec)
      }
    } catch (e) {
      rec.warnings.push('派生榜说明写入失败：' + String(e).slice(0, 50))
    }
    /**
     * ★ 工作包 A：写「精简索引 + 报告」的唯一入口 —— **按日逐榜合并**。
     *   旧实现 `buildSlim(rec, snaps)` 把整份文件换成「本批跑过的榜」：单榜重抓之后，
     *   当天其余榜从 slim 里消失 ⇒ 之后 historyFor 判「新入榜/回榜」会把回榜算成新入榜（体检 P1-A ②）。
     */
    const writeArtifacts = () => {
      try {
        const prevSlim = readSlim(root, artId)
        const incoming: Record<string, any[]> = {}
        const drop: string[] = []
        for (const b of batchBoards) {
          if (b.untrusted === true) { drop.push(b.boardId); continue }
          if (b.status !== 'ok') continue
          const snap = snaps.get(b.boardId)
          if (!snap || !(snap.rows || []).length) continue
          incoming[b.boardId] = (snap.rows || []).map((r: any) => ({ key: r.key, rank: r.rank, metric: r.value }))
        }
        writeSlim(root, mergeSlimBoards(prevSlim, artId, incoming, drop))
        writeReport(root, artId, renderReport(rec, root))
      } catch (e) {
        rec.warnings.push('精简索引/报告写入失败：' + String(e).slice(0, 60))
      }
    }
    writeArtifacts()
    /**
     * ★ 工作包 A：当天**逐榜**状态（批次记录 scan.json 只代表本批）。
     *   只更新本批真正跑过的榜；A 站失败不会被之后 B 站成功冲掉。
     */
    try {
      const idxPrev = store.readDayIndex(rec.dataDate)
      const updates: DayUpdate[] = rec.boards
        .filter((b) => batchIds.has(b.boardId))
        .map((b) => ({
          boardId: b.boardId,
          status: b.status,
          reason: b.reason ?? null,
          rows: b.untrusted === true ? 0 : (b.rows || []).length,
          trusted: b.untrusted !== true,
          at: b.capturedAt || rec.finishedAt || rec.startedAt,
          by: trigger,
          capturedAt: b.capturedAt ?? null,
          contentDate: b.contentDate ?? null,
          samePeriod: b.samePeriod === true,
        }))
      await store.writeDayIndex(mergeDayIndex(idxPrev, rec.dataDate, updates, new Date().toISOString()))
    } catch (e) {
      rec.warnings.push('逐榜状态索引写入失败：' + String(e).slice(0, 60))
    }
    /**
     * ★ 2026-10-17（补全移出阻塞路径）：把补全**从 /scan 的等待里摘出去**。
     * 抓 19 个榜只要 ~71 秒，补全却要 ~5 分钟（1 请求/秒，不可协商）——以前都算在「扫描」里，
     * 使用者看到的就是「转 6 分钟」+ 期间看不到补全进度。
     * 现在：先把本次范围内的榜**记成待办**（面板因此能显示「补全中 N/M」），立刻启动后台工人并返回；
     * 补全过程照旧受请求预算与「每榜每日 3 次」约束，逐个榜把字段补进快照。
     */
    /**
     * ★ 2026-10-17（审查阻塞 4）：defer 通道也要看 autoEnrich 开关。
     * 同步通道（postScanEnrich）第一行就是「关了就直接返回」，defer 分支以前不看 ⇒ 用户关掉自动补全照样跑。
     */
    if (opts && opts.deferEnrich && readState().autoEnrich !== false) {
      const only = (opts as any).partial ? batchBoards.filter((b) => b.untrusted !== true).map((b) => b.boardId) : undefined
      /**
       * ★ 2026-10-17（审查续核 ①）：起点/起点图另有「起点收藏与三江字数」开关（qidianEnrich）。
       * 同步通道在 postScanEnrich 里判过它；而 defer 路径的 worker 直接调 enrichBoard → qidianEnrichBoard，
       * 那条通道**不读** state.qidianEnrich ⇒ 关掉开关照样打起点书页。这里按站分闸。
       */
      const qdOn = readState().qidianEnrich === true
      const marks = (st.boards as string[])
        .filter((b) => (!only || only.indexOf(b) >= 0) && isEnrichableBoard(b))
        .filter((b) => qdOn || !(b.startsWith('qidian.') || b.startsWith('qidiantu.')))
      for (const b of marks) {
        const s: any = new FileStore(root).readSnapshot(rec.dataDate, b)
        if (s && needsEnrichRows(b, s.rows || []) > 0) markEnrichPending(rec.dataDate, b)
      }
      const queued = Object.keys(((readState() as any).enrichPending) || {}).length
      rec.warnings.push('补全已转入后台：' + queued + ' 个榜待补（抓榜数据已可用；面板顶部显示进度）')
      await store.writeScan(rec)
      writeArtifacts()
      startEnrichWorker('扫描后后台补全')
      /**
       * ★ 关键：不再跑 postScanEnrich（同步阻塞那 5 分钟）。
       * 但**不能**提前 return —— doScan 后面还有「书签机会式更新」与「占用缓存刷新」，
       * 用标志把同步补全段跳过即可。
       */
      opts.didEnrich = true
    }
    // 整站扫描后补全「站上不给」的字数/收藏（刺猬猫 2 + 菠萝包 3；单榜扫描不跑）
    if (opts && opts.enrichAfter && !opts.deferEnrich) {
      try {
        const res = await postScanEnrich((opts as any) && (opts as any).partial ? batchBoards.filter((b) => b.untrusted !== true).map((b) => b.boardId) : undefined)
        if (res && res.length) {
          const total = res.reduce((n, x) => n + (x.requests || 0), 0)
          /**
           * ★ 2026-10-16（补全持久化）：如实写「补了几个 / 还剩几个待续跑」。
           *   旧文案一律是「已补全 N 个榜」，而中断时最后一榜往往是裸的 ⇒ 报告与事实不符，
           *   使用者看到「已补全」却发现面板空着（这次排查的起点）。
           */
          const still: any = (readState() as any).enrichPending || {}
          const pendingN = res.filter((x: any) => still[x.boardId]).length
          rec.warnings.push('补全：' + res.length + ' 个榜跑了补全（' + total + ' 请求）' + (pendingN ? '；其中 ' + pendingN + ' 个仍缺字段，已记待办由定时续跑或在面板点「补齐本榜」' : ''))
          await store.writeScan(rec)
          writeArtifacts()
        }
      } catch (e) {
        rec.warnings.push('扫描后补全失败：' + String(e).slice(0, 50))
      }
    }
    if (opts && opts.enrichAfter) opts.didEnrich = true
    /**
     * 书签的机会式更新（A 档，0 请求）：用**刚抓完的**快照把书签里还在榜上的书变新。
     * 放在整轮扫描的最后：不阻塞抓取、不额外发一次请求。失败只记一行，不影响扫描结果。
     */
    try {
      const touched = await refreshBookmarksFromSnapshots()
      if (touched > 0) ctx.logger?.info?.('[' + name + '] 书签机会式更新：' + touched + ' 条')
    } catch (e) {
      ctx.logger?.info?.('[' + name + '] 书签机会式更新失败（不影响扫描）：' + String(e).slice(0, 80))
    }
    // ★ 票 26：扫描结束主动刷新占用缓存（面板随后读到的是新值，不用等 TTL）
    try { storageSummary(true) } catch { /* 缓存刷新失败不影响扫描 */ }
    return rec
  }

  /**
   * 定时抓取：到点触发（分精度），当天已成功扫描则跳过；电脑晚开机也在当天补跑一次。
   *
   * ★ 2026-10-15 事故后的三条硬约束（缺一不可，见 git 提交记录）：
   *   ① 「今天跑过没」**必须落盘**（state.lastTimerRun）：进程级变量在宿主重启后会重置，
   *      只看 dueNow 就会变成「每次重启 ⇒ 立刻补跑一次整站扫描 ⇒ 拖死宿主 ⇒ 再重启」的自我循环。
   *   ② 起始宽限期（默认 60 秒）：宿主刚起来时不许跑重活，避免与启动过程抢资源。
   *   ③ 同一进程内定时/手动共用一把锁（scanInFlight），任何时刻最多一个扫描在跑。
   * 每 30s 轮询一次是刻意的：宿主休眠后恢复最快 30s 就能补跑，且不依赖进程活到 01:30 那一刻。
   */
  const timerState = {
    scanInFlight: false,
    /** ★ 2026-10-17：后台补全工人是否在跑（避免 tick 与工人同时补同一批榜） */
    enrichWorker: false,
    /** ★ 票 25：宿主 timer 服务**是否可得**（不等于「已接线」） */
    wired: false,
    /** ★ 票 25：当前真的接了一个 30s 定时器时才有值（拿它当准） */
    disposer: null as null | (() => void),
    lastCheck: 0,
    startedAtMs: Date.now(),
    /** 宽限期压制日志去重（同一天同一时间只记一条，别刷屏） */
    graceLogged: null as string | null,
  }
  /** ★ 票 30：批量补全的时长上限（10 分钟）—— 到点停下并如实回报跳过了哪些榜 */
  const BATCH_ENRICH_CAP_MS = 10 * 60 * 1000

  /** ★ 票 25：宿主 timer 服务引用（开关变化时要能按需接/断） */
  let timerApi: any = null
  /** ★ 票 24：webServer 是否已挂上路由（诊断栏要如实显示） */
  let routeBound = false

  /**
   * ★ 票 26：数据目录占用统计缓存。
   * 旧实现**每个 /overview 请求**都递归 stat 整个数据目录（同步 fs、且在 HTTP 请求路径上），
   * 数据目录越大越卡宿主。现在 1 小时 TTL 懒刷新 + 扫描结束后主动刷新，面板只读缓存。
   */
  let storageCache: { at: number; total: number; state: number } | null = null
  const STORAGE_TTL_MS = 60 * 60 * 1000
  function storageSummary(force = false): { totalBytes: number; stateBytes: number; cachedAt: number } {
    const now = Date.now()
    if (force || !storageCache || now - storageCache.at > STORAGE_TTL_MS) {
      let total = 0
      let state = 0
      try { total = dirSize(root) } catch { total = 0 }
      try { state = dirSize(join(root, 'state')) } catch { state = 0 }
      storageCache = { at: now, total, state }
    }
    return { totalBytes: storageCache.total, stateBytes: storageCache.state, cachedAt: storageCache.at }
  }

  /**
   * ★ 票 25：定时器惰性接线 —— 开关为真才真的占一个 30s 定时器；关掉立刻断开。
   * 旧实现是 apply 时**无条件**接线，再在回调里判开关 ⇒ 没开定时的机器天天白醒 2880 次。
   * 返回「当前是否已接线」。
   */
  function syncTimer(): boolean {
    const want = readState().timerEnabled === true
    if (want && !timerState.disposer && timerApi && typeof timerApi.setInterval === 'function') {
      timerState.disposer = timerApi.setInterval(() => { void checkTimer().catch(() => { /* checkTimer 内部已兜底 */ }) }, 30_000)
      timerState.wired = true
      timerLog('定时器已接线（按需）ms=30000')
    } else if (!want && timerState.disposer) {
      try { timerState.disposer() } catch { /* 断开失败不影响业务 */ }
      timerState.disposer = null
      timerLog('定时器已断开（开关关闭）')
    }
    return !!timerState.disposer
  }
  /**
   * 宿主起来后多久才允许跑定时扫描（宽限期）。可用 config.timerFreshMs 覆盖。
   * ★ 2026-10-15 从 5 分钟收到 60 秒：使用者设了 18:19，插件恰好在 18:18 注入
   *   ⇒ 被 5 分钟宽限期压到 **18:23 才跑**，看着像「定时没生效」。
   *   这个宽限期的目的是躲开宿主启动期的资源竞态，60 秒足够，代价小得多。
   */
  const timerFreshMs = Number.isFinite(Number(cfg.timerFreshMs)) && Number(cfg.timerFreshMs) >= 0
    ? Number(cfg.timerFreshMs)
    : 60 * 1000
  /** 起点书页缓存 TTL（默认 7 天；插件配置 qidianCacheTtlDays 可改）。过了就重新打书页。 */
  const QIDIAN_CACHE_TTL_MS = (() => {
    const d = Number(cfg.qidianCacheTtlDays)
    return (Number.isFinite(d) && d > 0 ? d : 7) * 24 * 60 * 60 * 1000
  })()
  /**
   * ★ 2026-10-17：通用书页缓存 TTL（刺猬猫/菠萝包/番茄；插件配置 bookCacheTtlDays 可改）。
   * 实测每日榜单里 88% 的书号与前一天重合 ⇒ 命中缓存就不必再进书页。
   */
  const BOOK_CACHE_TTL_MS = (() => {
    const d = Number(cfg.bookCacheTtlDays)
    return (Number.isFinite(d) && d > 0 ? d : 7) * 24 * 60 * 60 * 1000
  })()

  /**
   * ★ 2026-10-17（3）：全局最小请求间隔做成配置（默认 1000ms = 原纪律，不折）。
   * 那个 1s 是本项目自设的保守值（spec-扫榜插件-v1:87 是我们自己写的），不是站点要求；
   * 它的唯一真实保护是「别把站点打毛了」。所以降格成显式配置项 + 面板可见的取舍，
   * 由使用者决定是否下调（下限 200ms，配置 0 视为关闭限速，仅建议在本地测试用）。
   */
  const REQUEST_INTERVAL_MS = (() => {
    /**
     * ★ 2026-10-17（发布前修）：**优先认面板存下来的值**。
     *   /select 把用户选的间隔写进 state（config.json 的 requestIntervalMs），但启动只读插件配置
     *   ⇒ 热重载/重启会把闸门悄悄退回配置默认值，state 里的值变成死数据（用户的选择无声消失）。
     *   口径：state 有值就用它，没有才回落到插件配置，最后兜底 1000ms。
     */
    let stored: unknown
    try { stored = (readState() as any).requestIntervalMs } catch { stored = undefined }
    const raw = stored === undefined || stored === null ? cfg.requestIntervalMs : stored
    const n = Number(raw)
    if (!Number.isFinite(n)) return 1000
    if (n === 0) return 0
    return Math.max(200, n)
  })()
  applyRequestInterval(REQUEST_INTERVAL_MS)

  /** 书页缓存的键：站内书号，**不用 URL**（URL 形态会变） */
  function bookIdFromUrl(u: string): string {
    const m = String(u || '').match(/\/book\/(\d+)/) || String(u || '').match(/\/Novel\/(\d+)/)
    return m ? m[1] : ''
  }

  /** 单次起点书页补全的请求上限（安全阀；插件配置 qidianEnrichBudget 可改） */
  const QIDIAN_ENRICH_BUDGET = (() => {
    const n = Number(cfg.qidianEnrichBudget)
    return Number.isFinite(n) && n > 0 ? n : 25
  })()
  /** 每榜每日最多尝试补全几次（防无限重跑；跨日由 enrichPending 的日期自动作废） */
  const ENRICH_TRIES_PER_DAY = 3
  /**
   * ★ 2026-10-17（审查阻塞 1/2）：**单榜**补全的请求预算，按需求 v1 Q2 分档：
   * 起点 / 起点图 40，刺猬猫 / 菠萝包 / 番茄 24。以前只在起点通道生效，且还被写死成一个跨榜总数。
   */
  function enrichBudgetForBoard(boardId: string): number {
    if (boardId.startsWith('qidian.') || boardId.startsWith('qidiantu.')) return 40
    return 24
  }
  /** 一次「后台补全工人」一轮的请求预算上限（安全阀：不让一轮把站点打太久） */
  const ENRICH_RUN_REQUEST_CAP = 60

  function timerLog(msg: string): void {
    try {
      const dir = join(root, 'state')
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, 'timer.log'), '[' + new Date().toISOString() + '] ' + msg + '\n')
    } catch { /* 日志失败不影响业务 */ }
  }

  /** 今天是否已经跑完一整轮（只算**真正会被扫的榜**：派生榜不进扫描集，算进去就永远为假 ⇒ 每天重扫） */
  async function hasCompletedToday(date: string): Promise<boolean> {
    const store = new FileStore(root)
    const rec: any = await store.readScan(date)
    if (!rec || !Array.isArray(rec.boards)) return false
    const want = ((readState().boards as string[]) || []).filter((b) => !b.startsWith('fanqie.derived.'))
    if (!want.length) return false
    return want.every((b) => {
      const row = rec.boards.find((x: any) => x.boardId === b)
      return row && row.status === 'ok'
    })
  }

  /**
   * ★ 2026-10-16（审计 P0-1）：定时回调是 fire-and-forget（`void checkTimer()`），而 checkTimer 里
   * 既有 try 之外的 await（:437/:448 那两处 hasCompletedToday），catch 里还会再写一次状态 ⇒
   * 任何一次逸出都会变成 unhandledRejection，命中宿主 dsh-app-boot 的 fail-loud（proc.exit(1)）：
   * **不是坏插件，是整个 DSH 退出**。这里统一兜底：内部怎么抛都只记一条 timer.log，绝不上抛。
   */
  async function checkTimer(): Promise<void> {
    try { await checkTimerInner() } catch (e) {
      try { timerLog('checkTimer 异常（已兜住，不上抛）：' + String(e).slice(0, 200)) } catch { /* 记日志本身失败也只能吞 */ }
    }
  }

  /**
   * 今天算「已经跑过」的站。
   *
   * ★ 2026-10-17（使用者反馈：手动扫一次就把当天剩下的计划吞掉）：旧实现只看「今天每个榜都有快照」，
   *   于是 02:19 手动扫过的站，10:40 / 12:40 的计划时刻再也不会跑 —— 那天的「计划数据」其实是
   *   早八竿子打不着的一次手动抓。现在的判据是**时刻**：
   *   ① 定时真的跑过（siteLastRun === today）⇒ 算跑过；
   *   ② 否则看该站今天最晚一次成功抓取的时刻（boardLastScan.at / 快照 mtime）：
   *      **≥ 计划时刻**才算跑过（说明计划时刻之后已经有人抓了，不重复请求）；
   *      早于计划时刻 ⇒ 到点还要补跑一次。
   * 用「最晚一次」而不是「每个榜都满足」是有意的：某个榜一直失败也不会让整站每 30 秒重跑一次。
   */
  function sitesRanToday(sites: string[], today: string, siteTimes?: Record<string, string>): string[] {
    const st: any = readState()
    const fst = new FileStore(root)
    const times = siteTimes || st.siteTimes || DEFAULT_SITE_TIMES
    const bls: any = st.boardLastScan || {}
    const out: string[] = []
    for (const s of sites) {
      const bs = ((st.boards as unknown as string[]) || []).filter((b: string) => siteOfBoard(b) === s)
      if (!bs.length) continue
      if ((st.siteLastRun || {})[s] === today) { out.push(s); continue }
      const plan = times[s] || DEFAULT_SITE_TIMES[s] || DEFAULT_FALLBACK_TIME
      let lastHM: string | null = null
      for (const b of bs) {
        const hit = bls[b]
        let at = hit && hit.date === today && hit.outcome === 'ok' ? String(hit.at) : ''
        if (!at) {
          const mt = fst.snapshotMtime(b, today)
          if (mt) at = new Date(mt).toISOString()
        }
        if (!at) continue
        const hm = hmOf(new Date(at))
        if (!lastHM || hm > lastHM) lastHM = hm
      }
      if (lastHM && lastHM >= plan) out.push(s)
    }
    return out
  }

  /**
   * ★ 2026-10-17（使用者问「兜底到底有没有生效」）：今天**定时跑过但没跑成**的站。
   *
   *   为什么需要它：跑失败也会写 siteLastRun=today（防 30 秒一次无脑重试），于是 due 永远不会再排它，
   *   而旧兜底分支只认「疑似未刷新」⇒ 一次失败 = 当天彻底没了。现在这类站进兜底队列，22:30 再试一次。
   *   判据：该站实际抓取集内任一榜没有「计划时刻之后」的成功抓取（本地派生榜除外）。
   */
  function sitesFailedToday(sites: string[], today: string, siteTimes?: Record<string, string>): string[] {
    const st: any = readState()
    const times = siteTimes || st.siteTimes || DEFAULT_SITE_TIMES
    const bls: any = st.boardLastScan || {}
    const out: string[] = []
    for (const s of sites) {
      if (((st as any).siteLastRun || {})[s] !== today) continue
      const plan = times[s] || DEFAULT_SITE_TIMES[s] || DEFAULT_FALLBACK_TIME
      const bs = ((st.boards as string[]) || []).filter((b: string) => siteOfBoard(b) === s)
      const incomplete = bs.filter((b: string) => !b.startsWith('fanqie.derived.')).some((b: string) => {
        const hit = bls[b]
        return !hit || hit.date !== today || hit.outcome !== 'ok' || hmOf(new Date(String(hit.at))) < plan
      })
      if (incomplete) out.push(s)
    }
    return out
  }

  /** 站 id → 中文名（面板/日志用） */
  const SITE_CN: Record<string, string> = { qidian: '起点', qidiantu: '起点图', ciweimao: '刺猬猫', sfacg: '菠萝包', fanqie: '番茄' }

  /** 现在这一刻的调度计划（只读；面板展示 + 集成测试都用它，零请求） */
  function timerPlanNow() {
    const st: any = readState()
    const sites = SITE_ORDER.filter((s) => ((st.boards as string[]) || []).some((b: string) => siteOfBoard(b) === s))
    const plan = planSiteRuns({
      nowHM: hmOf(new Date()),
      today: localDate(new Date()),
      boards: (st.boards as string[]) || [],
      siteTimes: st.siteTimes || DEFAULT_SITE_TIMES,
      siteLastRun: st.siteLastRun || {},
      fallbackTime: st.fallbackTime || DEFAULT_FALLBACK_TIME,
      ranToday: sitesRanToday(sites, localDate(new Date()), st.siteTimes || DEFAULT_SITE_TIMES),
      failed: sitesFailedToday(sites, localDate(new Date()), st.siteTimes || DEFAULT_SITE_TIMES),
      retried: st.siteRetry || {},
      stale: SITE_ORDER.filter((s) => Object.keys(st.staleFlag || {}).some((b) => siteOfBoard(b) === s && st.staleFlag[b]?.date === localDate(new Date()))),
    })
    /**
     * ★ 2026-10-16（疑问「关闭状态为什么显示今天已跑」）：把「这个站今天抓过没、谁抓的、几点抓的」
     * 明确摆出来 —— done 只表示**已有当天快照**（手动扫也算），不等于定时跑过。
     */
    const siteLastScan: Record<string, { date: string; at: string; by: string }> = {}
    const bls: any = (st as any).boardLastScan || {}
    for (const s of sites) {
      for (const b of ((st.boards as string[]) || []).filter((x: string) => siteOfBoard(x) === s)) {
        const hit = bls[b]
        if (!hit) continue
        const cur = siteLastScan[s]
        if (!cur || String(hit.at) > String(cur.at)) siteLastScan[s] = { date: String(hit.date), at: String(hit.at), by: String(hit.by || '?') }
      }
    }
    const today2 = localDate(new Date())
    const staleBoards = Object.keys(((st as any).staleFlag) || {}).filter((b) => (((st as any).staleFlag || {})[b] || {}).date === today2)
    const staleSites = SITE_ORDER.filter((s) => staleBoards.some((b) => siteOfBoard(b) === s))
    return { now: hmOf(new Date()), today: today2, enabled: st.timerEnabled === true, installedToday: (st as any).installedAt === today2, siteTimes: st.siteTimes || DEFAULT_SITE_TIMES, fallbackTime: st.fallbackTime || DEFAULT_FALLBACK_TIME, siteLastScan, staleSites, staleFlag: (st as any).staleFlag || {}, siteRetry: (st as any).siteRetry || {}, ...plan }
  }

  /**
   * ★ 2026-10-16（允许自定时刻）：**按站分时抓取**。
   * 每个站放它自己刷新点之后抓一次；一次 tick 只跑一个站（避免 5 站并发打满、也避免抢扫描锁）。
   * 当天没跑成的站，到 fallbackTime 再补跑一次。
   */
  async function checkTimerInner(): Promise<void> {
    const st = readState()
    // 关闭态直接返回，不刷 lastCheck（面板显示的就是「最后一次真正判定的时刻」）
    if (!st.timerEnabled) { timerState.lastCheck = Date.now(); return }
    timerState.lastCheck = Date.now()
    const today = localDate(new Date())
    if (timerState.scanInFlight) return
    const inGrace = Date.now() - timerState.startedAtMs < timerFreshMs
    if (inGrace) {
      const waited = Math.round((timerFreshMs - (Date.now() - timerState.startedAtMs)) / 1000)
      if (timerState.graceLogged !== today) {
        timerState.graceLogged = today
        timerLog('启动宽限期内先不跑（还需 ' + waited + 's）；按站抓取时刻 ' + JSON.stringify((st as any).siteTimes || DEFAULT_SITE_TIMES))
      }
      return
    }
    const sites = SITE_ORDER.filter((s) => ((st.boards as unknown as string[]) || []).some((b: string) => siteOfBoard(b) === s))
    // ★ 安装当天不自动跑（新装默认开着定时，但别在用户还在挑榜时突然发请求）
    if ((st as any).installedAt && (st as any).installedAt === today) {
      if (timerState.graceLogged !== 'installed' + today) {
        timerState.graceLogged = 'installed' + today
        timerLog('新安装当天不自动跑定时（明天起按各站时刻执行）')
      }
      return
    }
    const staleBoards = Object.keys(((st as any).staleFlag) || {}).filter((b) => ((st as any).staleFlag[b] || {}).date === today)
    const staleSites = SITE_ORDER.filter((s) => staleBoards.some((b) => siteOfBoard(b) === s))
    const plan = planSiteRuns({
      nowHM: hmOf(new Date()),
      today,
      boards: (st.boards as unknown as string[]) || [],
      siteTimes: (st as any).siteTimes || DEFAULT_SITE_TIMES,
      siteLastRun: (st as any).siteLastRun || {},
      fallbackTime: (st as any).fallbackTime || DEFAULT_FALLBACK_TIME,
      ranToday: sitesRanToday(sites, today, (st as any).siteTimes || DEFAULT_SITE_TIMES),
      failed: sitesFailedToday(sites, today, (st as any).siteTimes || DEFAULT_SITE_TIMES),
      stale: staleSites,
      retried: (st as any).siteRetry || {},
    })
    const target = plan.due[0] || plan.fallback[0]
    if (!target) {
      /**
       * ★ 2026-10-16（补全持久化）：没有该跑的站时，先看有没有**补全待办**（扫描时被打断的补全）。
       *   只跑补全、不重抓榜页；受请求预算与「每榜每日最多 3 次」限制；补齐即清条目。
       *   这就是「重启/中断后自愈」的那条路径 —— 之前它完全不存在。
       */
      try {
        const pend: any = (readState() as any).enrichPending || {}
        if (!Object.keys(pend).length) return
        /**
         * ★ 2026-10-17（面板闪烁：每 30 秒闪一次）：
         *   条目还在、但**当日额度已试满**（tried >= 3）时，工人一启动就只会立刻 giveup，
         *   而启动时已经先把 enrichRun 写成 active:true ⇒ 面板先显示「补全中 0/1 个榜」，
         *   3 秒后写回 active:false ⇒ 又变「补全已尽力」。tick 30 秒一次 ⇒ 一直这样跳。
         *   这里先问「还有没有能续跑的」，没有了就不起工人（不动 enrichRun，横幅保持静止）。
         */
        if (retryablePendingCount() === 0) return
        /**
         * ★ 2026-10-17：交给后台工人（它自己会落进度、逐榜跑、跑完退出），
         *   不再在这里同步阻塞一个 tick —— tick 每 30 秒一次，阻塞会让别的站到点跑不动。
         */
        startEnrichWorker('定时续跑')
      } catch (e) {
        timerLog('补全续跑异常（已吞）：' + String(e).slice(0, 160))
      }
      return
    }
    const isRetryRun = plan.due.indexOf(target) < 0 && plan.fallback.indexOf(target) >= 0
    const siteBoards = ((st.boards as unknown as string[]) || []).filter((b: string) => siteOfBoard(b) === target)
    timerState.scanInFlight = true
    const startedAt = new Date().toISOString()
    const recordRun = (state: string, note: string) => {
      // ★ 2026-10-16（审计 P0-1）：这里在**成功路径与 catch 路径**都会被调用；写盘失败
      //   （磁盘满 / EPERM / 目录被占）不允许再抛出去 —— 上面 checkTimer 的兜底是第二道，
      //   这里是第一道（历史上正是「catch 内再抛」把未处理拒绝送到 process 层的）。
      try {
        const st2 = readState()
        st2.lastTimerRun = today
        st2.lastTimerRunAt = startedAt
        st2.lastTimerState = state
        st2.lastTimerNote = note.slice(0, 300)
        // ★ 审计-2/39：迁移判据是 !== 6（见下方 v6 迁移），这里原来写回 3 ⇒ 每次启动都重跑一遍迁移
        ;(st2 as any).timerSchemaV = 6
        // ★ 按站分时：记「这个站今天跑过了」，下一个 tick 才会轮到别的站
        const slr: any = { ...((st2 as any).siteLastRun || {}) }
        slr[target] = today
        ;(st2 as any).siteLastRun = slr
        /**
         * ★ 2026-10-17：分开记「定时那次成功的时刻」与「最近一次抓取（含手动）」——
         *   只有日期的话，面板上「今天已抓（手动 11:43）」会让人以为计划 08:30 没跑。
         */
        if (state === 'ok') {
          const sla: any = { ...((st2 as any).siteLastTimerAt || {}) }
          sla[target] = startedAt
          ;(st2 as any).siteLastTimerAt = sla
        }
        // ★ C：这是「疑似未刷新」的补跑 ⇒ 记下来，每站每天最多补跑一次
        if (isRetryRun) {
          const srt: any = { ...((st2 as any).siteRetry || {}) }
          srt[target] = today
          ;(st2 as any).siteRetry = srt
        }
        writeState(st2)
      } catch (e) {
        try { timerLog('写定时状态失败（已吞）：' + String(e).slice(0, 200)) } catch { /* 同上一道 */ }
      }
    }
    timerLog('定时扫描开始（按站）site=' + target + ' boards=' + siteBoards.length + ' 时刻=' + ((st as any).siteTimes || DEFAULT_SITE_TIMES)[target])
    try {
      // 补全只在定时任务里跑（手动「立刻扫一次」不带，避免误触百请求级长任务）
      // ★ 2026-10-17（审查阻塞 3）：定时是主路径，同样走 defer（抓完即返回，补全交给后台工人）
      const rec: any = await doScan('timer', { boards: siteBoards, enrichAfter: st.autoEnrich !== false, deferEnrich: true, partial: true, site: target })
      const note = (rec.warnings || []).join(' | ')
      timerLog('定时扫描结束 site=' + target + ' outcome=' + rec.outcome + ' progress=' + rec.progress.done + '/' + rec.progress.total +
        (note ? ' warnings=' + note : ''))
      recordRun(rec.outcome === 'completed' ? 'ok' : 'failed', note)
    } catch (e) {
      // 失败也落盘日期：否则失败会被 next 轮 30s 又捡起来无脑重试；次日自然重来
      const msg = String(e)
      timerLog('定时扫描异常：' + msg.slice(0, 200))
      recordRun('failed', msg)
    } finally {
      timerState.scanInFlight = false
    }
  }

  /** 定时接线：直取 ctx.setInterval（timer 服务）；拿不到再走依赖光纤晚绑定。 */
  function bindTimer(t: any): boolean {
    if (!t || typeof t.setInterval !== 'function') return false
    /**
     * ★ 迁移只做一件事：**补字段，绝不碰开关**。
     *
     * 2026-10-16 两次修正的最终形态：
     *   ① 最早的 v2 迁移（`timerSchemaV !== 2 ⇒ timerEnabled=false`）与 v6（写 6）冲突 ⇒「6 !== 2」恒真
     *      ⇒ **每次启动都把用户的开关关掉**（使用反馈「我明明打开过，谁关的」，timer.log 直证）。
     *   ② 把它改成「字段缺失才关一次」只是止血；使用者最终口径是 **默认开、用户可关、重载保留**
     *      ⇒ 直接**删掉**这条迁移：任何代码路径（除面板 /timer 接口本人操作）都不许写 timerEnabled。
     *
     * 升级上来的老配置靠 defaultState 兜底（没存过 = 用新默认「开」），已存过的值原样保留。
     */
    try {
      // v6（2026-10-16）：补 staleFlag/siteRetry/installedAt/按站分时（**不翻开关**）
      const cur1: any = readJson(statePath, {})
      // v6（2026-10-16）：补 staleFlag/siteRetry/installedAt（老配置不视作「安装当天」、不翻开关）
      if (cur1 && cur1.timerSchemaV !== 6) {
        const st1: any = readState()
        st1.siteTimes = { ...DEFAULT_SITE_TIMES, ...(st1.siteTimes || {}) }
        st1.fallbackTime = st1.fallbackTime || DEFAULT_FALLBACK_TIME
        st1.siteLastRun = st1.siteLastRun || {}
        st1.boardLastScan = st1.boardLastScan || {}
        st1.staleFlag = st1.staleFlag || {}
        st1.siteRetry = st1.siteRetry || {}
        /**
         * 老配置**不视作「安装当天」**（否则升级当天就不会抓了），也**不翻开关**。
         * ★ 判据必须看**原始文件**有没有这个字段：readState 会用 defaultState 兜底出「今天」，
         *   直接读 st1.installedAt 会把老用户误判成「今天刚装」。
         */
        st1.installedAt = cur1.installedAt == null ? 'legacy' : cur1.installedAt
        // ★ 若「安装当天」其实是今天却**存在更早的数据日期**，说明这不是新装（v4 曾把老用户误写成今天）
        if (st1.installedAt === localDate(new Date()) && listDataDates(root).some((d) => d < st1.installedAt)) st1.installedAt = 'legacy'
        st1.timerSchemaV = 6
        writeState(st1)
        timerLog('v4 迁移：按站分时 = ' + JSON.stringify(st1.siteTimes) + '（兜底 ' + st1.fallbackTime + '；installedAt=' + st1.installedAt + '）')
      }
    } catch { /* 迁移失败不该挡住接线 */ }
    timerApi = t
    // ★ 票 25：不再无条件接线 —— 只有开关为真时才真的占一个 30s 定时器
    const armed = syncTimer()
    timerLog('timer 服务已就绪（懒接线 armed=' + armed + '）ms=30000 freshMs=' + timerFreshMs + ' timerEnabled=' + (readState().timerEnabled === true))
    ctx.logger?.info?.('[' + name + '] 定时扫描服务已就绪（每 30s 轮询；当前 armed=' + armed + '，扫点 ' + readState().scanTime +
      '，启动宽限 ' + Math.round(timerFreshMs / 1000) + 's）')
    return true
  }

  function renderReport(rec: any, rootDir: string): string {
    const lines = ['# 扫榜报告 ' + rec.dataDate, '', '- 触发：' + rec.trigger + '（第 ' + rec.attempt + ' 次）', '- 结果：' + rec.outcome, '- 进度：' + rec.progress.done + '/' + rec.progress.total]
    if (rec.warnings.length) lines.push('- 警告：' + rec.warnings.join('；'))
    lines.push('', '| 榜 | 状态 | 条数 | 请求 | 说明 |', '|---|---|---|---|---|')
    for (const b of rec.boards) lines.push('| ' + b.boardId + ' | ' + b.status + ' | ' + b.rows.length + ' | ' + b.requests + ' | ' + (b.reason || '') + ' |')
    lines.push('', '数据目录：' + rootDir)
    return lines.join('\n') + '\n'
  }

  async function boardIdsOf(date: string): Promise<string[]> {
    const st = new FileStore(root)
    const rec = await st.readScan(date)
    return rec ? rec.boards.map((b: any) => b.boardId) : []
  }

  /**
   * ★ 工作包 A（2026-10-22）：当天逐榜状态索引 + 可信度 + 数据 revision。
   *   三者都以「这一次请求要展示的数据日期」为键读取，缺文件时回退老口径（不报错）。
   */
  function dayIndexOf(date: string | null | undefined): DayIndex | null {
    if (!date) return null
    try { return new FileStore(root).readDayIndex(date) } catch { return null }
  }
  /** 这一天的这份快照是否被拒（stale 隔离；raw 仍在盘上） */
  function isUntrusted(date: string, boardId: string): boolean {
    try { return new FileStore(root).isUntrusted(date, boardId) } catch { return false }
  }
  /**
   * ★ 工作包 A：**该榜自己的上一次可信成功数据日**（跨过缺日、跨过被拒快照）。
   *   旧口径只看「全局上一数据日期」：该榜那天没跑成功就判「首次采集」⇒ 变化整列空、
   *   概览涨/新/退为 null（体检 P1-B：三江 10-18 缺一天，10-19 被误判 firstEver）。
   */
  function previousBoardDate(boardId: string, date: string, dates?: string[]): string | null {
    const st = new FileStore(root)
    return previousTrustedDate(dates || listDataDates(root), date, (d) => st.readSnapshot(d, boardId), (d) => st.isUntrusted(d, boardId))
  }
  /**
   * ★ 2026-10-25（防永久锁）：从 date 往前数，**连续**多少个数据日被判不可信。
   *   基准只取可信快照 ⇒ 判错一次就会一直拿同一份旧内容重判；连续 3 天时由扫描侧放行（见 doScan）。
   */
  function consecutiveUntrustedDays(boardId: string, date: string): number {
    const st = new FileStore(root)
    const ds = listDataDates(root)
    let n = 0
    for (let i = ds.length - 1; i >= 0; i--) {
      const d = ds[i]
      if (d >= date) continue
      if (!st.readSnapshot(d, boardId)) break
      if (!st.isUntrusted(d, boardId)) break
      n += 1
    }
    return n
  }
  /**
   * ★ 工作包 A：手工补数（/day 落盘、/repair）之后把「这一榜这一天」恢复为可信，
   *   并同步当天逐榜索引 —— 否则隔离标记会一直挂着，展示端永远不给看。
   */
  async function trustBoardDay(date: string, boardId: string, at: string): Promise<void> {
    const store = new FileStore(root)
    try { store.clearUntrusted(date, boardId) } catch { /* 清标记失败不影响补数结果 */ }
    const snap: any = store.readSnapshot(date, boardId)
    const rows = snap && Array.isArray(snap.rows) ? snap.rows.length : 0
    const idxPrev = store.readDayIndex(date)
    const updates: DayUpdate[] = [{
      boardId, status: 'ok', reason: null, rows, trusted: true, at, by: 'manual', capturedAt: at, contentDate: null,
    }]
    await store.writeDayIndex(mergeDayIndex(idxPrev, date, updates, at))
    if (snap) writeSlim(root, mergeSlimBoards(readSlim(root, date), date, {
      [boardId]: snap.rows.map((r: any) => ({ key: r.key, rank: r.rank, metric: r.value })),
    }))
  }

  /** 同一数据日期内数据是否变化（前端据此重取；含补全改写的快照） */
  function dataRevision(date: string | null | undefined): string | null {
    if (!date) return null
    const store = new FileStore(root)
    const idx = (() => { try { return store.readDayIndex(date) } catch { return null } })()
    let stats: SnapshotStat[] = []
    let untrusted: string[] = []
    try { stats = store.snapshotStats(date) } catch { stats = [] }
    try { untrusted = store.untrustedBoards(date) } catch { untrusted = [] }
    return revisionDigest(idx ? idx.revision : 0, stats, untrusted)
  }

  function diffFor(boardId: string, date: string, prevDate: string | null, jitter?: number, slimAll?: any[]) {
    const store = new FileStore(root)
    const current = store.readSnapshot(date, boardId)
    if (!current) return { boardId, status: 'missing', note: '当天没有该榜快照' }
    const previous = prevDate ? store.readSnapshot(prevDate, boardId) : null
    // ★ 审计-2/38（Q11「同一请求内只读一次」）：调用方可以一次读好传进来，避免每个榜都全量重读。
    const indexes = slimAll ?? (listSlim(root).map((d) => readSlim(root, d)).filter(Boolean) as any[])
    const history = historyFor(indexes, boardId, date)
    /**
     * ★ 2026-10-16（跨期不可比保护）：周期榜的「期」用**快照里记的真实期号**，不用本地推算的日期。
     *   三江每行的 extra.periodStart 就是那次请求的期首日；刺猬猫首订(约)每行的 extra.issue
     *   就是第三方接口给的期号。两者都能直接回答「上一数据日与本次是不是同一期」；
     *   推不出期号（老快照）⇒ 交给 guardCrossPeriod 的保守分支，不猜。
     */
    const keyFromRows = (s: any, field: string): string | null => {
      for (const r of (s && s.rows) || []) {
        const v = r && r.extra && (r.extra as any)[field]
        if (v == null) continue
        const t = String(v)
        if (t) return field === 'issue' ? String(Number(t)) : t
      }
      return null
    }
    const periodKeyOf = boardId === 'qidiantu.sanjiang'
      ? (dt: string) => keyFromRows(dt === current.dataDate ? current : previous, 'periodStart')
      : boardId === 'ciweimao.buy.latest'
        ? (dt: string) => keyFromRows(dt === current.dataDate ? current : previous, 'issue')
        : undefined
    const d = computeBoardDiff({ boardId, metric: current.metric, current, previous, history, jitter, periodKeyOf })
    return {
      boardId,
      metric: current.metric,
      baselineDate: d.baselineDate,
      firstEver: d.firstEver,
      // ★ 跨期不可比 ⇒ 调用方必须把变化列判为「不可比」（置空 / 显示「新期」）
      crossPeriod: !!d.crossPeriod,
      counts: { new: d.newEntry.length, rebound: d.rebound.length, up: d.up.length, down: d.down.length, flat: d.flat.length, out: d.out.length },
      newEntry: d.newEntry,
      rebound: d.rebound,
      up: d.up,
      down: d.down,
      // ★ flat 必须一起回传：面板要按它给「持平」的行标记名次 delta=0。
      //   2026-10-15 修：此前 flat 整组丢掉 ⇒ 名次没动/±2 内的行 delta 落 null，
      //   「变化」列大面积显示「—」（实测起点 20 行里 18 行是「—」，真实 flat=17）。
      flat: d.flat.slice(0, 200),
      out: d.out,
      metricDelta: d.metricDelta.slice(0, 20),
    }
  }

  /**
   * ★ 从**该榜自己的快照文件**累积历史（2026-10-15）。
   * 原来 `daysOnBoard` 的历史来自 **slim 精简索引**（`historyFor(indexes, …)`），
   * 而 slim 是历史产物：早期抓取集只有 1 个榜时写下的 slim 里**只登记了那一个榜**
   * ⇒ 其它榜（起点其它子分类、番茄等）即使抓了多天也拿不到历史，
   * 导致「在榜天数」要么整列不出，要么每行只能退化成 1 天。
   * 这里改成直接遍历该榜的快照，与抓取集/交付时间无关。
   */
  function historyFromSnapshots(boardId: string, beforeDate: string): Map<string, { lastDate: string; dates: string[] }> {
    const st2 = new FileStore(root)
    const m = new Map<string, { lastDate: string; dates: string[] }>()
    for (const d of listDataDates(root)) {
      if (d >= beforeDate) continue
      const s: any = st2.readSnapshot(d, boardId)
      if (!s || !Array.isArray(s.rows)) continue
      for (const r of s.rows) {
        if (r == null || r.key == null) continue
        const e = m.get(String(r.key)) || { lastDate: d, dates: [] }
        e.dates.push(d)
        if (d > e.lastDate) e.lastDate = d
        m.set(String(r.key), e)
      }
    }
    return m
  }

  const text = (v: any) => { try { return JSON.stringify(v, null, 2) } catch { return String(v) } }

  /** 主指标列名（面板排序项按它命名）：名次型 = 名次；数值型 = 该榜的主指标名 */
  function mainLabelOf(boardId: string, meta: any): string {
    if (boardId.startsWith('fanqie.derived.')) return '今日涨幅'
    if (meta && meta.metric === 'value') {
      /**
       * ★ 2026-10-22（工作包 A）：三江的主指标是**收藏增量**（value / periodTotal），不是首订。
       *   旧实现把所有 qidiantu.* 一律叫「首订」⇒ 排序项、书签 metric 全带错标签（体检 P3）。
       */
      if (boardId === 'qidiantu.sanjiang') return '收藏增量'
      if (boardId === 'qidiantu.shouding') return '首订'
      if (boardId.startsWith('qidiantu.')) return '收藏增量'
      if (boardId === 'ciweimao.buy.latest') return '首订（约）'
      return '在读'
    }
    return '名次'
  }

  /**
   * 机会式更新（A 档，0 请求）：书签里的书若出现在某个已抓榜的快照里，就把第 2、3 类字段更新掉。
   * ★ 只在扫描结束后调用，**绝不在渲染路径联网**；★ 备注与夹（用户内容）永不触碰（由 service 保证）。
   * 只接受「比现在更新的数据日期」，避免把旧快照写回去。
   */
  /**
   * 书签卡片要显示的「站方数据」——口径按站不同：
   *   番茄 = **在读**（行里 value 就是它；api/book/info 的 readCount 同义）
   *   起点 / 起点图 / 刺猬猫 / 菠萝包 = **收藏**
   *
   * ★ 取值链刻意做到「0 请求」：
   *   ① 行里自带 extra.collect（起点图首订、刺猬猫三榜、菠萝包新书榜都有）
   *   ② 起点签约榜行里没有收藏 ⇒ 读 state/qidian-book-cache.json（书页缓存，已有 78 条）
   *   ③ 都没有 ⇒ null，卡片显示「—」，**不为了一个数字当场发请求**
   *   （起点签约榜的收藏靠扫描后的书页补全回填，那是既有机制）
   */
  function collectOf(site: string, row: any): { value: number | null; label: string; from: string } {
    const ex = (row && row.extra) || {}
    const label = site === 'fanqie' ? '在读' : '收藏'
    if (site === 'fanqie') {
      const v = typeof row?.value === 'number' ? row.value : (typeof ex.readCount === 'number' ? ex.readCount : null)
      return { value: v, label, from: v != null ? 'snapshot' : 'none' }
    }
    if (typeof ex.collect === 'number') return { value: ex.collect, label, from: 'snapshot' }
    if (site === 'qidian' || site === 'qidiantu') {
      const id = String(row?.key == null ? '' : row.key)
      const c = readQidianBookCache()[id]
      if (c && typeof c.collect === 'number') return { value: c.collect, label, from: 'qidian-book-cache' }
    }
    return { value: null, label, from: 'none' }
  }

  /** 起点书页缓存（键 = 站内书号）——只读，用来给没有收藏列的行兜底 */
  function readQidianBookCache(): Record<string, any> {
    try {
      const j: any = readJson(join(root, 'state', 'qidian-book-cache.json'), {})
      return (j && (j.books || j)) || {}
    } catch (e) { return {} }
  }

  async function refreshBookmarksFromSnapshots(): Promise<number> {
    const svc = BOOKMARKS
    if (!svc) return 0
    const list = svc.all()
    if (!list.length) return 0
    const st = readState()
    const boards = (st.boards as string[]) || []
    const store = new FileStore(root)
    const dates = listDataDates(root)
    let touched = 0
    for (const bm of list) {
      let best: { boardId: string; date: string; row: any } | null = null
      for (const date of dates) {
        for (const boardId of boards) {
          /**
           * ★ 工作包 A：**被拒快照不参与书签自动更新** —— 否则 tab 里会写进一份
           *   站方还没刷新的旧值，且之后看起来像「今天的数据」。
           */
          if (isUntrusted(date, boardId)) continue
          const snap: any = store.readSnapshot(date, boardId)
          if (!snap || !Array.isArray(snap.rows)) continue
          const row = snap.rows.find((r: any) => String(r.key) === String(bm.bookKey.split(':').slice(1).join(':')))
          if (!row) continue
          if (!best || date > best.date) best = { boardId, date, row }
        }
      }
      if (!best) continue
      const prevAnchor = (bm.metricBoard && bm.metricDate) ? { board: bm.metricBoard, date: String(bm.metricDate) } : null
      if (prevAnchor && best.date < prevAnchor.date) continue
      if (prevAnchor && best.date === prevAnchor.date && !bm.firstSeen) { /* 仍可补来源 */ }
      const row = best.row
      const meta: any = boardMeta(best.boardId)
      const ex = (row.extra || {}) as any
      const words = typeof ex.wordsCnt === 'number' ? ex.wordsCnt
        : typeof ex.wordNumber === 'number' ? ex.wordNumber
        : typeof ex.words === 'number' ? ex.words : null
      const title = decodeFenqiIfNeeded(row.title)
      const author = decodeFenqiIfNeeded(row.author)
      const col = collectOf(String((meta && meta.site) || bm.site || ''), row)
      svc.autoUpdate(bm.bookKey, {
        title: title || null,
        author: author || null,
        words,
        collect: col.value,
        collectLabel: col.label,
        collectFrom: col.from,
        // ★ 2026-10-16（使用者反馈「书签里番茄显示两个在读 / 其他站多一个空名次」）：
        //   ① 名次型榜的 row.value 恒为 null（名次在 row.rank；而书签卡片按 spec-书签-v1:120 本来就不显示名次）
        //      ⇒ 没有数值就**不写** metric，别让盘上留下 {name:'名次', value:null} 被渲染成「名次 —」；
        //   ② 番茄的 metric 与 collect 同源（都是 row.value = 在读）⇒ 同值时不重复写。
        ...(typeof row.value === 'number' && row.value !== col.value
          ? { metric: { name: mainLabelOf(best.boardId, meta), value: row.value } }
          : {}),
        metricBoard: best.boardId,
        metricDate: best.date,
        valueFrom: 'snapshot',
        capturedAt: new Date(best.date + 'T12:00:00+08:00').toISOString(),
        url: row.url || undefined,
        site: (meta.site || undefined) as any,
      }, { boardId: best.boardId, rank: typeof row.rank === 'number' ? row.rank : null, dataDate: best.date }, { promoteToBoard: true })
      touched++
    }
    return touched
  }

  /** 番茄书名/作者可能是私用区码点（字体反爬）⇒ 落盘前解一次；非番茄原样返回（实现见 scan/fontmap.ts，那里可离线测） */
  function decodeFenqiIfNeeded(s: any): string | null {
    return decodeIfPua(root, s)
  }
  // ── 面板数据（同源只读；**渲染不联网**，交互只读本地快照） ──────────
  function panelCtx() {
    const st = readState()
    const dates = listDataDates(root)
    return { st, dates, latest: dates[dates.length - 1] || null }
  }

  async function panelOverview() {
    const { st, dates, latest } = panelCtx()
    const store = new FileStore(root)
    const rec: any = latest ? await store.readScan(latest) : null
    /** ★ Spec E：本轮正在跑时的内存记录（见 doScan 顶部注释）；结束/抛错即清空 */
    const liveScan: any = activeScan || null
    const prevDate = latest ? previousDataDate(dates, latest) : null
    /**
     * ★ 工作包 A：**当天逐榜状态**以 day-index.json 为准（scan.json 只是一批）。
     *   没有 day-index 的旧数据回退到老口径（rec.boards / 快照存在性），不报错、不伪造。
     */
    const day = latest ? store.readDayIndex(latest) : null
    const slimAll = listSlim(root).map(d => readSlim(root, d)).filter(Boolean) as any[]
    const rows: any[] = []
    for (const boardId of st.boards as string[]) {
      const meta = boardMeta(boardId)
      const b = rec && rec.boards ? rec.boards.find((x: any) => x.boardId === boardId) : null
      const dstate = boardDayState(day, boardId)
      const snap = latest ? store.readSnapshot(latest, boardId) : null
      // ★ 逐榜基准：该榜自己的上一次可信成功（跨过缺日），不是「全局上一数据日」
      const bPrev = snap && latest ? previousBoardDate(boardId, latest, dates) : null
      const trusted = dstate ? dstate.trusted !== false : !(latest && isUntrusted(latest, boardId))
      /** ★ 2026-10-25：批次榜不比较变化（见 view.ts#isBatchBoard） */
      const isBatch = isBatchBoard(boardId)
      const diff = !isBatch && trusted && snap && latest && bPrev ? diffFor(boardId, latest, bPrev, undefined, slimAll) : null
      const c = diff && !diff.crossPeriod && (diff as any).counts ? (diff as any).counts : null
      const batch = isBatch && snap && latest
        ? (() => {
            const kind = batchKindOf(boardId)
            const key = batchKeyOf(kind, snap.rows) || (kind === 'date' ? addDays(latest, -1) : null)
            return { key, label: batchLabelOf(kind, key), count: (snap.rows || []).length }
          })()
        : null
      /**
       * ★ 2026-10-17（发布前修）：**本地派生榜**（fanqie.derived.*）永远不会有 scan 记录、
       *   也不会落快照文件（数据是打开榜页时现算的）⇒ 旧口径「b ? … : snap ? 'ok' : 'missing'」
       *   必然把它判成 missing，备注还套用「今天还没扫（或该榜抓取失败）」，并且计入异常数
       *   ⇒ 概览永远显示「异常 1 个榜」。它不是「没扫到」，是「不需要扫」：状态直接给 ok。
       */
      const derived = boardId.startsWith('fanqie.derived.')
      const today = localDate(new Date())
      const attemptedToday = (st.boardLastScan as any)?.[boardId]?.date === today || (latest === today && !!(dstate || b))
      const plannedTime = (st.siteTimes as Record<string, string>)?.[meta.site] || DEFAULT_SITE_TIMES[meta.site] || DEFAULT_FALLBACK_TIME
      const scheduleState = !derived && st.timerEnabled && !attemptedToday
        ? (hmOf(new Date()) < plannedTime ? 'waiting' : 'due') : null
      rows.push({
        scheduleState, plannedTime,
        boardId,
        name: meta.name,
        site: meta.site,
        siteName: meta.siteName,
        /**
         * ★ 工作包 A：优先用当天逐榜状态（含 missing/stale/truncated/login_required 五态）；
         *   没有 day-index 才回退老口径。派生榜按设计不扫描 ⇒ 恒 ok。
         */
        status: derived ? 'ok' : dstate ? dstate.status : b ? b.status : snap ? 'ok' : 'missing',
        /** true = 内容可信（stale 隔离后为 false；前端据此不给「正常」字样） */
        trusted: derived ? true : dstate ? dstate.trusted !== false : !(latest && isUntrusted(latest, boardId)),
        /** true = 同一期未变化（周期榜正常形态） */
        samePeriod: dstate ? dstate.samePeriod === true : false,
        /** 当天最近一次尝试（失败原因留在这里，不被之后的成功批次冲掉） */
        attempt: dstate ? dstate.lastAttempt : null,
        /** 当天最近一次可信成功的时刻（没有就 null） */
        lastSuccessAt: dstate && dstate.lastSuccess ? dstate.lastSuccess.at : null,
        up: c ? c.up : null,
        newCount: c ? c.new + c.rebound : null,
        out: c ? c.out : null,
        /** 批次榜：这一批是什么（不是「涨/新/退」，面板据此替换成「第 N 期 · M 本」） */
        batch,
        changesEligible: !isBatch,
        /**
         * ★ 2026-10-17（使用者反馈「为什么 20 个榜都显示 08:30」）：以前取的是**整轮扫描记录**的
         *   finishedAt ⇒ 所有榜共用同一时刻，看着像「按站抓取没生效」。改成三层：
         *   ① 这一榜自己的 capturedAt（扫描成功时写）；② 快照文件 mtime（老数据兜底）；
         *   ③ 都没有（本地派生榜 / 今天没抓到的榜）就留 null，面板显示「—」，不再拿别人的时间冒充。
         */
        lastCapture: (function () {
          // ★ 工作包 A：优先「当天最近一次可信成功」；否则退回本批的 capturedAt / 旧兜底
          if (dstate && dstate.lastSuccess && dstate.lastSuccess.at) return String(dstate.lastSuccess.at)
          const own = b && (b as any).capturedAt ? String((b as any).capturedAt) : null
          if (own) return own
          if (derived) return null
          // ★ 老数据（没有 capturedAt）：boardLastScan 里每个榜都记着「哪天的几点抓的、谁抓的」
          const hit = ((st as any).boardLastScan || {})[boardId]
          if (hit && hit.date === latest && hit.at) return String(hit.at)
          const mt = latest ? store.snapshotMtime(boardId, latest) : null
          return mt ? new Date(mt).toISOString() : null
        })(),
        note: derived
          ? '本地派生（0 请求，打开榜页时现算）'
          : dstate
            ? (dstate.reason || (dstate.samePeriod ? '同一期未变化（正常）' : null))
            : b ? b.reason || null : snap ? null : '今天还没扫（或该榜抓取失败）',
        extended: !!meta.extended,
        source: meta.source || null,
        mainLabel: mainLabelOf(boardId, meta),
        derived,
        displayed: (st.display as string[]).includes(boardId),
      })
    }
    const counts: Record<string, number> = { ok: 0, missing: 0, stale: 0, login_required: 0, truncated: 0 }
    for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1
    return {
      dataDate: latest,
      dates,
      baselineDate: prevDate,
      firstEver: dates.length < 2,
      counts,
      /**
       * ★ 工作包 A：同日数据 revision。扫描/单榜重抓/补全只要改写了快照或隔离标记就会变，
       *   前端不必等「数据日期」变化才重取（体检 P2-C 的后端侧支撑）。
       */
      revision: dataRevision(latest),
      dayRevision: day ? day.revision : null,
      // 派生榜按设计不进 display ⇒ 不能算进「隐藏 N 个」（它不是被藏起来的，是不需要单独扫）
      hiddenCount: rows.filter((r) => !r.displayed && !r.derived).length,
      sites: groupBySite(rows).map((s) => ({ ...s, boards: rows.filter((r) => r.site === s.site) })),
      /**
       * 数据目录占用（ticket 22 验收项：面板显示占用）。
       * state/ 单独算一份：它不受 retentionDays 影响（配置/书签/书页缓存都在里面），
       * 拆开显示才能让人一眼看出「快照在涨还是 state 在涨」。
       */
      storage: (() => {
        // ★ 票 26：改读缓存（1 小时 TTL；扫描结束会主动刷新），不再每次请求递归 stat 整个目录
        const sz = storageSummary()
        const total = sz.totalBytes
        const stateSize = sz.stateBytes
        return {
          totalBytes: total,
          stateBytes: stateSize,
          cachedAt: new Date(sz.cachedAt).toISOString(),
          snapshotBytes: Math.max(0, total - stateSize),
          dates: dates.length,
          oldest: dates[0] || null,
          newest: dates[dates.length - 1] || null,
          retentionDays: (st as any).retentionDays !== undefined ? (st as any).retentionDays : 180,
          bookmarks: BOOKMARKS ? BOOKMARKS.sync().total : 0,
        }
      })(),
      // ★ 票 24/26：诊断栏要的服务可见性（缺服务时面板照常，只把「缺什么」显示出来）
      services: {
        webServer: routeBound,
        timerService: timerState.wired,
        timerArmed: !!timerState.disposer,
    /** ★ 按站分时：现在会跑哪个站、每站上次跑过的数据日（面板「抓什么」页展示） */
    schedule: timerPlanNow(),
      },
      /**
       * ★ Spec E（2026-10-24）：运行中优先用**内存活跃记录**（onProgress 每榜更新），
       *   落盘 scan.json 只在整轮结束才写 ⇒ 旧实现在扫描过程中永远回上一轮的 completed。
       *   inFlight 让面板能区分「真的在跑」与「上次进程崩了留下的 running」：
       *   后者不该显示进度、也不该高频轮询。
       */
      scan: (liveScan || rec)
        ? {
            outcome: (liveScan || rec).outcome,
            attempt: (liveScan || rec).attempt,
            trigger: (liveScan || rec).trigger,
            progress: (liveScan || rec).progress,
            warnings: (liveScan || rec).warnings,
            startedAt: (liveScan || rec).startedAt,
            inFlight: !!liveScan,
          }
        : null,
      defaults: {
        scanTime: st.scanTime,
        timerEnabled: st.timerEnabled === true,
        // 面板「概览」用这几项核对定时到底在不在跑：
        //   timerWired    = 已接上宿主 timer 服务
        //   timerLastCheck= 本进程最近一次判定的时刻
        //   lastTimerRun  = 落盘的「今天已由定时扫过」日期（跨重启有效，防重复补跑的凭据）
        timerWired: timerState.wired,
        timerLastCheck: timerState.lastCheck ? new Date(timerState.lastCheck).toISOString() : null,
        timerFreshMs,
        lastTimerRun: st.lastTimerRun || null,
        lastTimerRunAt: st.lastTimerRunAt || null,
        lastTimerState: st.lastTimerState || null,
        lastTimerNote: st.lastTimerNote || null,
        autoEnrich: st.autoEnrich !== false,
        boards: st.boards.length,
        display: st.display.length,
      },
    }
  }

  const parseWords = (v: any): number => {
    if (typeof v === 'number') return v
    if (typeof v !== 'string') return NaN
    const m = v.match(/([\d.]+)\s*万字/)
    if (m) return Number(m[1]) * 10000
    const n = Number(v.replace(/[^\d.]/g, ''))
    return Number.isFinite(n) ? n : NaN
  }

  /** 排序取值：名次/变化/在榜天数 + 字数/收藏（取 extra 里的真实字段） */
  const sortVal = (r: any, key: string): number | null => {
    const ex = r.extra || {}
    if (key === 'words') return parseWords(ex.wordsText !== undefined ? ex.wordsText : ex.wordsCnt !== undefined ? ex.wordsCnt : ex.wordNumber !== undefined ? ex.wordNumber : ex.words)
    if (key === 'collect') return typeof ex.collect === 'number' ? ex.collect : null
    if (key === 'value') return typeof r.value === 'number' ? r.value : null
    // 派生榜的「本期累计涨幅」在 extra 里
    if (key === 'periodDelta') return typeof ex.periodDelta === 'number' ? ex.periodDelta : null
    // 番茄：在读在 extra 里（行 value 是「今日涨幅」，不是在读）
    if (key === 'read') return typeof ex.read === 'number' ? ex.read : null
    // 三江：期初收藏 / 今日增量 / 期累计（都在 extra）
    if (key === 'collectBase' || key === 'dailyDelta' || key === 'periodTotal') {
      return typeof ex[key] === 'number' ? ex[key] : null
    }
    const v = key === 'days' ? r.days : key === 'delta' ? r.delta : r[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  // 缺失值统一成 null ⇒ 由 compareDesc 显式压到最后（不要用 +Infinity：倒序时它会窜到榜首）
  const num = (x: any): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

  /** 该榜可用的排序项（按「这个榜真有什么」给，不再让客户端硬编码） */
  function sortOptionsFor(boardId: string, meta: any, flags: { hasHistory: boolean }): { value: string; label: string }[] {
    // 派生榜（在读周榜）单独一套：默认=今日涨幅倒序（名次就是它），另给本期累计/在读
    if (boardId.startsWith('fanqie.derived.')) {
      return [
        { value: '', label: '默认（今日涨幅）' },
        { value: 'value', label: '今日涨幅' },
        { value: 'periodDelta', label: '本期累计涨幅' },
        { value: 'read', label: '在读' },
      ]
    }
    // 起点图三江（2026-10-15 使用者）：默认按**期初收藏**；另给今日增量 / 期累计
    if (boardId === 'qidiantu.sanjiang') {
      return [
        { value: '', label: '默认（期初收藏）' },
        { value: 'collectBase', label: '期初收藏' },
        { value: 'dailyDelta', label: '今日增量' },
        { value: 'periodTotal', label: '期累计增量' },
      ]
    }
    const main = mainLabelOf(boardId, meta)
    const opts = [{ value: '', label: '默认（名次）' }]
    // 列名口径：番茄主指标列叫 read（不是 value），排序值必须对上列 key 才不会被客户端过滤掉
    const mainKey = meta.site === 'fanqie' && !boardId.startsWith('fanqie.derived.') ? 'read' : 'value'
    if (meta.metric === 'value') opts.push({ value: mainKey, label: main })
    opts.push({ value: 'words', label: '字数' })
    // 收藏：起点、起点图首订，以及**靠书页补全后有收藏值**的刺猬猫/菠萝包
    if (meta.site === 'qidian' || boardId === 'qidiantu.shouding' || meta.site === 'ciweimao' || meta.site === 'sfacg') opts.push({ value: 'collect', label: '收藏' })
    // 既定口径（2026-10-15）：排序里**不要**「在榜天数」（列仍然按需出现，但不作为排序项）
    void flags.hasHistory
    if (meta.metric === 'value') opts.push({ value: 'delta', label: '变化（本地环比）' })
    // ★ 兜底过滤（2026-10-15）：排序项必须对应**该榜真实存在的列**，
    //   否则列被口径改掉后（比如三江去掉「已结算天数」），下拉里还残留一个按不存在字段排的项。
    const keys = new Set(applyColumnPolicy(columnsFor(meta, { hasBaseline: flags.hasHistory, hasHistory: flags.hasHistory }), boardId).map((c) => c.key))
    return opts.filter((o) => !o.value || keys.has(o.value))
  }

  /**
   * ★ 2026-10-25（批次榜）：把「数据日期」折成「批」。
   *   刺猬猫首订一期跨 7 个数据日、内容雷同（实测 issue 478 = 10-17..10-23），
   *   日期下拉原来列 12 项、其中 7 项是同一期 ⇒ 按批只留一个代表快照日（优先最新**可信**日）。
   *   起点图首订是「一天一批（按上架日）」，每批同样只有一个代表日。
   */
  function batchPeriodsFor(boardId: string, datesFor: string[]): { key: string; label: string | null; date: string; dates: string[]; count: number; untrusted: boolean }[] {
    const kind = batchKindOf(boardId)
    if (!kind) return []
    const store = new FileStore(root)
    const groups = new Map<string, { key: string; dates: string[]; rows: any[] }>()
    for (const d of datesFor) {
      const snap: any = store.readSnapshot(d, boardId)
      if (!snap || !(snap.rows || []).length) continue
      const key = batchKeyOf(kind, snap.rows) || (kind === 'date' ? addDays(d, -1) : null)
      if (!key) continue
      const g = groups.get(key) || { key, dates: [], rows: [] }
      if (!g.dates.includes(d)) g.dates.push(d)
      if (!g.rows.length) g.rows = snap.rows
      groups.set(key, g)
    }
    const out: { key: string; label: string | null; date: string; dates: string[]; count: number; untrusted: boolean }[] = []
    for (const g of groups.values()) {
      const trusted = g.dates.filter((d) => !store.isUntrusted(d, boardId))
      const rep = (trusted.length ? trusted : g.dates).slice(-1)[0]
      /**
       * 本数取**代表日**那份快照的行数：同一期会继续补书（实测 478 期首日 15 本、次日 17 本），
       * 拿首日数会少报。
       */
      const repSnap: any = store.readSnapshot(rep, boardId)
      const count = repSnap && Array.isArray(repSnap.rows) ? repSnap.rows.length : g.rows.length
      out.push({ key: g.key, label: batchLabelOf(kind, g.key), date: rep, dates: g.dates.slice(), count, untrusted: trusted.length === 0 })
    }
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    return out
  }

  async function panelBoard(boardId: string, dateArg?: string, sort?: string, limit = 0) {
    const wantedSort = sort === 'rank' ? undefined : sort
    const { st, dates, latest } = panelCtx()
    const meta = boardMeta(boardId)
    const defaultSortKey = defaultSortKeyFor(boardId)
    const store = new FileStore(root)
    /**
     * ★ 日期下拉按**该榜自己有快照的日期**过滤（2026-10-15 使用反馈）：
     *   之前面板用全局「所有数据日期」，于是给某个榜点一次历史查询，那个日期就会出现在**所有站点**的下拉里。
     *   过滤之后每个榜只列自己真有的日期，别的站/别的榜的历史不会串进来。
     */
    // 派生榜没有自己的快照（它按区间动态算，且始终算最新一期）⇒ 日期下拉对它无意义，给空数组让前端隐藏
    const datesFor = boardId.startsWith('fanqie.derived.') ? [] : dates.filter((d) => !!store.readSnapshot(d, boardId))
    /**
     * ★ 2026-10-25（批次榜）：下拉控件是「批」不是「日期」。
     *   没显式指定时，落到**最新一批**的代表日（优先最新可信日；整批都不可信才落到最新日并标 stale）。
     */
    const isBatch = isBatchBoard(boardId)
    const periods = isBatch ? batchPeriodsFor(boardId, datesFor) : []
    /**
     * 批次榜对外只暴露「批的代表日」：客户端下拉直接用它当选项（协议不变，仍传 date）。
     * 同一期的 7 个数据日不再重复出现。
     */
    const shownDates = isBatch ? periods.map((p) => p.date) : datesFor
    const useDate = dateArg && dates.includes(dateArg)
      ? dateArg
      : (isBatch && periods.length ? periods[periods.length - 1].date : latest)
    // 「在榜天数」只在**该榜真有历史**时才占列：原判断是全站的（任何榜有历史 ⇒ 每站都挂一列空的），
    // 使用者 2026-10-15 点名起点图不要这一列 ⇒ 改成按榜查精简索引里有没有它更早的记录。
    if (!latest) {
      const colsNone = applyColumnPolicy(columnsFor(meta, { hasBaseline: false, hasHistory: false }), boardId)
      return { boardId, meta, columns: colsNone, dataDate: null, dates: [], rows: [], defaultSortKey, note: '还没有任何快照：先点「立刻扫一次」' }
    }
    // 到这里 latest 一定非空 ⇒ 把日期收窄成非空的本地量（TS 不会因为 latest 非空就收窄 useDate）
    const date = useDate as string
    /**
     * 「在榜天数」的显示条件（2026-10-15 使用者二次反馈后改）：
     *   判据是**这个榜自己有没有 ≥2 个数据日**，而不是「精简索引里出现过」。
     *   原因：精简索引是历史产物 —— 早期抓取集只有 1 个榜时写的 slim 里只注册了那一个榜，
     *   于是其它榜（起点图/刺猬猫/菠萝包/番茄）即使两天都抓到了，也会被判成「没历史」而不出这一列。
     *   现在：该榜**有任何本地数据**就出列（一天也出，新书显示 1 天）；值由 daysOnBoard 从快照历史算。
     */
    // 「在榜天数」口径见 view.ts#shouldShowDays（起点图强制不出；其余站看该榜有没有更早的数据日）
    // 该榜有任何本地数据就出这一列（单日时每行是「1 天」；没有更早数据 ≠ 没历史）
    const hasHistory = shouldShowDays(meta.site, datesFor.length)
    // 列集合统一过一遍站点口径（起点图不出名次变化、三江不出重复的 daily、刺猬猫首订不出在榜天数）
    // ★ 工作包 A：「有基准」要按**该榜自己**有没有上一次可信快照判（不能拿全局日期数冒充）
    const boardPrev = previousBoardDate(boardId, date, dates)
    const columns = applyColumnPolicy(columnsFor(meta, { hasBaseline: !!boardPrev, hasHistory }), boardId)
    // 派生榜（番茄在读涨幅榜 / 七日累计）：纯本地算，不发请求
    if (boardId.startsWith('fanqie.derived.')) {
      const read = (b: string, d: string) => store.readSnapshot(d, b)
      const pool = (st.boards as string[]).filter((b) => b.startsWith('fanqie.m.'))
      /**
       * ★ 0.6.1（使用者 2026-10-29「番茄在读周榜有时候卡住显示不了内容」）：
       *   原来拿**全局最新数据日** latest 建池。今天的目录可能只有别的站（实测 2026-10-29 只有起点
       *   三个榜，番茄 0 个快照）⇒ 池子为空 ⇒ 0 行，而 note 照常输出「已结算 N/7 天」，
       *   看上去就像面板卡住没内容。
       *   现在：算池子的日期 = **最新一个番茄真有快照的日期**；全局最新日另有提示。
       */
      const hasPoolRows = (d: string) => pool.some((b) => {
        const s = store.readSnapshot(d, b)
        return !!(s && s.rows && s.rows.length)
      })
      const poolDates = dates.filter(hasPoolRows)
      const poolDate = poolDateOf(dates, hasPoolRows)
      const calcDate = poolDate || latest
      const lagNote = !poolDate
        ? '番茄还没有任何本地快照（' + latest + ' 也没有）：先在「设置 → 抓取范围」里勾上番茄，或等下次扫描'
        : poolDate !== latest
          ? '番茄最新快照是 ' + poolDate + '（' + latest + ' 还没有番茄快照），本榜按 ' + poolDate + ' 算'
          : null
      const views = deriveFanqieViews(read as any, { date: calcDate, poolBoards: pool, dataDates: poolDates })
      const v = views.find((x) => x.boardId === boardId) || views[0]
      // 派生榜行自带 extra.periodDelta / gain / settledDays；days 位给「池内天数」（列被 hideColumnsFor 隐藏，仅作诊断）
      let rows = (v ? v.rows : []).map((r: any) => ({ ...r, days: r.extra && r.extra.inPoolDays != null ? r.extra.inPoolDays : null }))
      // ★ 派生榜必须**自己**应用排序（2026-10-15 发现「按在读排序没反应」）：
      //   这个分支 return 在通用排序代码**之前**，所以 sort 参数到这里就丢了。
      const derivedSort = wantedSort || defaultSortFor(boardId)
      if (derivedSort) rows = rows.slice().sort((a: any, b: any) => compareDesc(num(sortVal(a, derivedSort)), num(sortVal(b, derivedSort))))
      return {
        boardId,
        meta: { ...meta, mainLabel: mainLabelOf(boardId, meta) },
        columns,
        defaultSortKey,
        sortOptions: sortOptionsFor(boardId, meta, { hasHistory }),
        depth: (st.depths || {})[boardId] ?? 30,
        dataDate: calcDate,
        dates: datesFor,
        // 期首 = 本期周一（自然周口径）；面板「基期」显示的就是它
        baselineDate: v ? v.periodStart : null,
        periodStart: v ? v.periodStart : null,
        periodEnd: v ? v.periodEnd : null,
        settledDays: v ? v.settledDays : 0,
        elapsed: v ? v.elapsed : 0,
        datesLabel: v ? v.datesLabel : '',
        firstEver: poolDates.length < 2,
        rows,
        // 池子不是按「全局最新日」算的时候，必须说清用的是哪天（不然空表看不出原因）
        note: [lagNote, v ? v.note : null].filter(Boolean).join('；') || null,
      }
    }
    let snap = store.readSnapshot(date, boardId)
    let fallbackFrom: string | null = null
    if (!snap) {
      const older = dates.filter((d) => d < date).slice(-1)[0]
      if (older) {
        snap = store.readSnapshot(older, boardId)
        fallbackFrom = older
      }
    }
    if (!snap) return { boardId, meta, columns, dataDate: useDate, dates: shownDates, rows: [], defaultSortKey, note: '该榜在这天没有快照（也没找到更早的可用快照）' }
    const effDate = fallbackFrom || date
    /**
     * ★ 2026-10-25（批次榜）：这一屏属于哪一批。面板据此把「数据日期 / 对比 YYYY-MM-DD」
     *   换成「第 479 期 · 上架日 2026-10-23 · 共 17 本」，并且不再给变化计数。
     */
    const batch = isBatch
      ? (() => {
          const kind = batchKindOf(boardId)
          const key = batchKeyOf(kind, snap.rows) || (kind === 'date' ? addDays(effDate, -1) : null)
          const range = kind === 'issue' ? saleRangeOf(snap.rows) : null
          const saleStart = range ? range.start : (kind === 'date' ? key : null)
          const saleEnd = range ? range.end : (kind === 'date' ? key : null)
          return {
            kind,
            key,
            label: batchLabelOf(kind, key),
            count: (snap.rows || []).length,
            saleStart,
            saleEnd,
            snapshotDate: effDate,
            unit: kind === 'issue' ? '期' : '上架日',
          }
        })()
      : null
    /**
     * ★ 工作包 A：逐榜基准 = **该榜自己的上一次可信成功**（跨过缺日、跨过被拒快照）。
     *   旧口径只看全局上一数据日：该榜缺一天 → previousPer 为空 → 整列变化空、firstEver=true（体检 P1-B）。
     */
    const prevDate = previousBoardDate(boardId, effDate, dates)
    /**
     * ★ 工作包 A：**stale 隔离**。raw 快照保留在盘上（证据），但不进展示：
     *   返回空行 + 明确状态，前端只需按 status/note 显示说明（不再拿被拒页面当今天榜单）。
     */
    if (isUntrusted(effDate, boardId)) {
      const mark = store.readUntrusted(effDate, boardId)
      return {
        boardId,
        meta: { ...meta, mainLabel: mainLabelOf(boardId, meta) },
        defaultSortKey,
        sortOptions: sortOptionsFor(boardId, meta, { hasHistory }),
        depth: (st.depths || {})[boardId] ?? (meta.site === 'fanqie' ? 30 : 10),
        columns,
        dataDate: effDate,
        requestedDate: date,
        fallbackFrom,
        dates: shownDates,
        baselineDate: prevDate,
        firstEver: !prevDate,
        counts: null,
        batch,
        periods,
        changesEligible: false,
        status: 'stale',
        trusted: false,
        rawRows: (snap.rows || []).length,
        attempt: store.readDayIndex(effDate)?.boards?.[boardId]?.lastAttempt || null,
        revision: dataRevision(effDate),
        enrich: null,
        rows: [],
        note: '本次抓到内容不可信（' + String((mark && mark.reason) || '疑似未刷新/换榜') + '）。原始快照已保留在 ' + effDate + '/' + boardId + '.json，但本次不展示、不参与变化。',
        source: meta.source || null,
      }
    }
    /**
     * ★ 2026-10-25：批次榜**不算变化**（批内不变、跨批不可比）⇒ 不跑 diff、不给计数。
     *   留给客户端的只有「这一批是什么」，涨/新/退一律为 null（显示「—」，不是 0）。
     */
    const diff: any = !isBatch && prevDate ? diffFor(boardId, effDate, prevDate) : null
    const byKey = new Map<string, any>()
    if (diff) {
      // 五个组都要建索引（flat 也不许漏，否则持平行的名次 delta 取不到）
    const groups: [string, any[]][] = [['new', diff.newEntry], ['rebound', diff.rebound], ['up', diff.up], ['down', diff.down], ['flat', diff.flat]]
      for (const [g, list] of groups) for (const e of list || []) byKey.set(e.key, { group: g, delta: e.delta, days: e.days })
    }
    // ★ 「在榜天数」独立于 diff 计算（2026-10-15）：某榜只有**一天**快照时 prevDate 为空 ⇒ diff 为 null
    //   ⇒ 所有行 days 落 null，整列即便显示了也是空的。这里从快照累积的历史直接算：
    //   今天第一次出现的书 = 1 天；连着出现就往上累加（断档归 1）。
    const histSnap = historyFromSnapshots(boardId, effDate)
    // 对照读数（番茄/派生榜用）：取上一数据日同 key 的值 ⇒ 面板「在读变化」= 今日 − 昨日
    const prevSnap = prevDate ? store.readSnapshot(prevDate, boardId) : null
    /**
     * ★ 2026-10-16（跨期不可比保护）：三江的总增量 / 刺猬猫首订(约)的名次在**换期当天**是
     *   跨期相减 —— 数值本身真实、含义却是错的。判为不可比：变化列置空 + 行上打标记
     *   （面板变化列显示「新期」）+ 榜说明写明原因。
     *   期号取自快照（三江 extra.periodStart / 刺猬猫 extra.issue）；推不出就不猜（保守判跨期）。
     */
    const keyFromSnap = (s: any, field: string): string | null => {
      for (const rr of (s && s.rows) || []) {
        const v = rr && rr.extra && (rr.extra as any)[field]
        if (v == null) continue
        const t = String(v)
        if (t) return field === 'issue' ? String(Number(t)) : t
      }
      return null
    }
    const guard = guardCrossPeriod({
      boardId,
      prevDate,
      date: effDate,
      /**
       * ★ 工作包 A：期键一律取快照里的**真实期号** —— 三江 = extra.periodStart，
       *   刺猬猫首订(约) = extra.issue。旧实现只给刺猬猫接了这个口，三江退回「本周日」推算，
       *   而缺日/跨周时推算出的期与站点实际期不一致 ⇒ 跨期保护会漏判。
       */
      periodKeyOf: boardId === 'qidiantu.sanjiang'
        ? (dt: string) => keyFromSnap(dt === effDate ? snap : prevSnap, 'periodStart')
        : boardId === 'ciweimao.buy.latest'
          ? (dt: string) => keyFromSnap(dt === effDate ? snap : prevSnap, 'issue')
          : undefined,
    })
    const crossPeriod = guard.crossed
    const prevByKey = new Map<string, number>()
    for (const r of (prevSnap && prevSnap.rows) || []) {
      const v = typeof r.value === 'number' ? r.value : null
      if (v !== null) prevByKey.set(String(r.key), v)
    }
    // ★ 名次型榜的「变化」必须用**名次差**（使用者 2026-10-15）：
    //   computeBoardDiff 对 value 型榜把 delta 算成「数值差」⇒ 番茄的「变化」列显示的其实是在读差，
    //   与「在读变化」列完全重复。这里按榜口径取上一数据日的真实名次重算一次。
    const useRank = usesRankDelta(boardId)
    const prevRankByKey = new Map<string, number>()
    if (useRank) {
      for (const r of (prevSnap && prevSnap.rows) || []) {
        if (typeof r.rank === 'number') prevRankByKey.set(String(r.key), r.rank)
      }
    }
    const today = localDate(clock.now())
    /**
     * ★ 2026-10-16（使用反馈「菠萝包书名又变回截断」）：站方在**榜单页**就把长书名截成「…」，
     * 只有补全（进书页）才能拿到全名；而手动「立刻扫一次」按 10-15 的口径刻意不跑补全 ⇒
     * 新一天的快照又回到截断书名。这里在**显示层**向上回溯最多 3 个数据日，找同一本书曾经补全过的
     * 全名/作者来补渲染（快照里仍保留站方原始行 —— 数据诚实，只影响显示）。
     */
    const fullNameByKey = new Map<string, { title: string; author: string | null; from: string }>()
    const cutTitle = (t: any) => typeof t === 'string' && /(\.\.\.|…)\s*$/.test(t.trim())
    if ((snap.rows || []).some((r: any) => cutTitle(r.title) || (r.extra && r.extra.titleTruncated === true))) {
      let probe = effDate
      for (let i = 0; i < 3; i++) {
        const older = previousDataDate(dates, probe)
        if (!older) break
        probe = older
        const old = store.readSnapshot(older, boardId)
        if (!old) continue
        for (const rr of (old.rows || [])) {
          const key = String((rr as any).key)
          if (fullNameByKey.has(key)) continue
          if (cutTitle((rr as any).title) || ((rr as any).extra && (rr as any).extra.titleTruncated === true)) continue
          fullNameByKey.set(key, { title: (rr as any).title, author: ((rr as any).author as any) || null, from: older })
        }
      }
    }
    let rows = (snap.rows || []).map((r: any) => {
      const dd = byKey.get(r.key)
      const base = prevByKey.get(String(r.key))
      const cur = typeof r.value === 'number' ? r.value : null
      // ★ 番茄的行把分类存成 extra.catId（数字）⇒ 解析成 extra.cat，否则「分类」列恒为「—」（2026-10-15 修）
      const extra: any = meta.site === 'fanqie' ? withFanqieCat(r.extra) : { ...(r.extra || {}) }
      // ★ 2026-10-16：用历史里补全过的全名覆盖截断书名（只影响渲染；来源日期记在 extra.titleFrom）
      const full = fullNameByKey.get(String(r.key))
      const titleOut = full && (cutTitle(r.title) || extra.titleTruncated === true) ? full.title : r.title
      const authorOut = full && !r.author ? full.author : r.author
      if (full && titleOut !== r.title) { extra.titleTruncated = false; extra.titleFrom = full.from }
      if (base !== undefined) extra.prevRead = base
      /**
       * ★ 2026-10-16：主指标的**数值差**（番茄 = 在读差）放进 extra.valueDelta。
       *   原来写在 extra.delta，而下面名次差那一段会把 row.delta 赋成名次差；旧客户端
       *   「在读变化」单元格读的是 extra.delta ⇒ 番茄整列显示的是名次差（名次没动就是 0/—），
       *   与「在读变化 = 我方按天的在读差」的口径不符（spec-扫榜插件-v1 / 取证文档）。
       */
      if (base !== undefined && cur !== null) extra.valueDelta = cur - base
      // 三江：今日增量（daily 里 date === 今天 的那条；未到的天为 null）
      if (Array.isArray(extra.daily)) {
        const hit = extra.daily.find((x: any) => x && x.date === today)
        extra.dailyDelta = hit && hit.delta != null ? hit.delta : null
        // ★ 期累计（2026-10-15 使用者指出三江缺合计）：已结算各日增量之和；
        //   未到的天是 null ⇒ 天然不计入。全期都没结算时给 null（不是 0）。
        const settled = extra.daily.filter((x: any) => x && x.delta != null)
        extra.periodTotal = settled.length ? settled.reduce((s: number, x: any) => s + Number(x.delta), 0) : null
      }
      // 原数据来源页（使用者 2026-10-15）：起点图首订 → 起点图 /info；刺猬猫「首订（约）」→ 第三方源
      if (boardId === 'ciweimao.buy.latest' && !extra.sourceUrl) extra.sourceUrl = CIWEIMAO_BUY_URL
      /**
       * ★ 起点图三江的字数（使用者 2026-10-15）：三江那个表**没有任何字数字段**，
       *   只能从起点书页取（m.qidian.com/book/<id>/ 的 "wordsCnt"）。
       *   走「起点收藏」那套书页缓存：命中就直接补，没命中就等 postScanEnrich / 面板按钮去抓。
       *   这里只做**缓存命中**的补值，绝不在这里发请求（渲染路径不许联网）。
       */
      if (boardId.startsWith('qidiantu.') && extra.wordsCnt == null) {
        const cached = cachedBook(root, String(r.key), QIDIAN_CACHE_TTL_MS)
        const stat = cached && cached.stat
        if (stat && stat.wordsCnt != null) extra.wordsCnt = stat.wordsCnt
      }
      // 名次型榜：变化 = 上一日名次 − 今日名次（正=上升）；持平（|Δ|≤2）显示 0；上一日不在榜 ⇒ null（新入榜由 deltaGroup 表达）
      let deltaOut: number | null = dd ? dd.delta : null
      let groupOut: string | null = dd ? dd.group : null
      // ★ 跨期不可比 ⇒ 明确标在行上，变化列显示「新期」而不是一个假的变化数字
      if (crossPeriod) extra.periodChanged = true
      if (useRank) {
        const pr = prevRankByKey.get(String(r.key))
        const cr = typeof r.rank === 'number' ? r.rank : null
        if (crossPeriod) {
          deltaOut = null
          groupOut = dd ? dd.group : 'flat'
        } else if (pr != null && cr != null) {
          deltaOut = pr - cr
          groupOut = dd ? dd.group : (Math.abs(deltaOut) <= jitterForBoard(boardId) ? 'flat' : deltaOut > 0 ? 'up' : 'down')
        } else if (typeof (r.extra && r.extra.rankPosDiff) === 'number') {
          /**
           * ★ 回退到站方给的名次差（2026-10-15 体检发现）：
           *   番茄源里本来就带 `rankPosDiff`（每行都有），而我们此前**只存不用** ⇒ 番茄各分类榜
           *   在该榜**没有上一数据日快照**时，「变化」列整列全是「—」（实测 m.new.262：30/30 行空）。
           *   站方这个字段就是「名次变化」，正好补上本地算不出来的那段。
           *   注意：只有在本地**拿不到**上一日名次时才用它，避免与本地名次差重复或打架。
           *   `deltaGroup` 仍按本地口径给：站方差值不给「新入榜/回榜」语义，那不归它管。
           */
          const rpd = r.extra.rankPosDiff as number
          deltaOut = rpd
          groupOut = dd ? dd.group : Math.abs(rpd) <= 2 ? 'flat' : rpd > 0 ? 'up' : 'down'
        } else {
          deltaOut = null
        }
      }
      // ★ 在榜天数从**快照累积的历史**算（不再取 diff 的 days：diff 只在有基准日时才存在，
      //   某榜只有一天快照时整列会全是 null）
      return { ...r, title: titleOut, author: authorOut, extra, delta: deltaOut, deltaGroup: groupOut, days: daysOnBoard(String(r.key), effDate, histSnap) }
    })
    // 兜底解码：早于映射表的快照、或派生榜从旧快照取的标题，渲染时再解一次
    if (meta.site === 'fanqie') {
      const fmap = loadFontMap(root)
      if (Object.keys(fmap).length) {
        rows = rows.map((r: any) => {
          const t = hasPua(r.title) ? decodePua(r.title, fmap).text : r.title
          const a = hasPua(r.author) ? decodePua(r.author, fmap).text : r.author
          return a === r.author && t === r.title ? r : { ...r, title: t, author: a }
        })
      }
    }
    // ★ 排序一律**倒序**（使用者 2026-10-15：按字数/收藏/首订排序要「最大的在前」）：
    //   num() 把缺失值统一成 +Infinity ⇒ 倒序时缺失值会被排到最后（不是最前），这正合口径。
    // ★ 该榜有自己的「默认排序」时，未显式选排序也按它排（使用者 2026-10-15：三江默认按期初收藏）
    const effSort = wantedSort || defaultSortFor(boardId)
    if (effSort) rows = rows.slice().sort((a: any, b: any) => compareDesc(num(sortVal(a, effSort)), num(sortVal(b, effSort))))
    if (limit > 0) rows = rows.slice(0, limit)
    /**
     * ★ 工作包 A：状态取**当天逐榜索引**（而不是「最后一批扫描记录」）。
     *   旧实现读 scan.json：一天 5 批之后只剩最后一站的记录 ⇒ 其余站的状态被洗成 ok/missing。
     */
    const dayIdxB = store.readDayIndex(effDate)
    const dstateB = boardDayState(dayIdxB, boardId)
    const statusRow = (await store.readScan(effDate) as any)
    const brd = statusRow && statusRow.boards ? statusRow.boards.find((x: any) => x.boardId === boardId) : null
    /**
     * ★ 2026-10-16（补全持久化）：把「这个榜的补全是不是没跑完」如实告诉面板。
     *   reason: 'none' 不出现；'raw' = 抓完就没补上（可能被打断）；'exhausted' = 当日已放弃；
     *   'date' = 待办记的是别的数据日（历史回放时不动它）。
     */
    const enrichInfo = (() => {
      if (!isEnrichableBoard(boardId)) return null
      const pe: any = (readState() as any).enrichPending || {}
      const rec = pe[boardId]
      const lastSnap: any = store.readSnapshot(latestDataDate(), boardId)
      const missing = needsEnrichRows(boardId, (lastSnap && lastSnap.rows) || [])
      if (!rec) return missing ? { pending: false, missing, reason: 'raw', tried: 0 } : null
      if (rec.date !== latestDataDate()) return { pending: true, missing, reason: 'date', tried: rec.tried || 0 }
      return {
        pending: missing > 0,
        missing,
        reason: (rec.tried || 0) >= ENRICH_TRIES_PER_DAY ? 'exhausted' : 'pending',
        tried: rec.tried || 0,
      }
    })()
    return {
      boardId,
      meta: { ...meta, mainLabel: mainLabelOf(boardId, meta) },
      defaultSortKey,
      sortOptions: sortOptionsFor(boardId, meta, { hasHistory }),
      depth: (st.depths || {})[boardId] ?? (meta.site === 'fanqie' ? 30 : 10),
      columns,
      dataDate: effDate,
      requestedDate: date,
      fallbackFrom,
      dates: shownDates,
      /** ★ 批次榜：可选「批」列表（每批一个代表快照日 + 标签） */
      periods,
      batch,
      /** false = 该榜不参与「变化」（批次榜整批换新，比较没有意义） */
      changesEligible: !isBatch,
      baselineDate: diff ? diff.baselineDate : null,
      firstEver: diff ? diff.firstEver : true,
      counts: diff && !crossPeriod ? diff.counts : null,
      crossPeriod: isBatch ? false : crossPeriod,
      status: dstateB ? dstateB.status : brd ? brd.status : 'ok',
      trusted: dstateB ? dstateB.trusted !== false : !isUntrusted(effDate, boardId),
      samePeriod: dstateB ? dstateB.samePeriod === true : false,
      /** 当天最近一次尝试（含失败原因）—— 失败不会被之后别的站的成功冲掉 */
      attempt: dstateB ? dstateB.lastAttempt : null,
      /** 同名数据日期内的数据 revision（前端据此重取，不必等跨日） */
      revision: dataRevision(effDate),
      enrich: enrichInfo,
      rows,
      // ★ 跨期当天必须写明「变化列为什么是空的」（口径说明跟着数据一起走，别只活在代码注释里）
      note: isBatch
        ? ([
            batch && batch.label ? batch.label + ' · 共 ' + batch.count + ' 本' : '批次榜 · 共 ' + ((snap.rows || []).length) + ' 本',
            '批次榜整批换新，不比较变化',
          ].join('；') + (meta.caliber ? '。' + meta.caliber : ''))
        : crossPeriod
          ? (guard.prevPeriod && guard.curPeriod && guard.prevPeriod !== guard.curPeriod
              ? '⚠ 本期已换期（期号 ' + guard.prevPeriod + ' → ' + guard.curPeriod + '）：「变化」列跨期不可比，一律显示「新期」'
              : '⚠ 本期已换期：「变化」列跨期不可比，一律显示「新期」')
            + (meta.caliber ? '。' + meta.caliber : '')
          : (meta.caliber || null),
      source: meta.source || null,
    }
  }

  async function panelChanges(dateArg?: string) {
    const { st, dates, latest } = panelCtx()
    if (!latest) return { date: null, baselineDate: null, firstEver: true, sites: [], count: 0, note: '还没有任何快照' }
    const useDate = dateArg && dates.includes(dateArg) ? dateArg : latest
    const prevDate = previousDataDate(dates, useDate)
    const store = new FileStore(root)
    const slimAll = listSlim(root).map(d => readSlim(root, d)).filter(Boolean) as any[]
    const entries: any[] = []
    let firstEver = true
    /** ★ 工作包 A：当天有快照但被拒的榜（不让它们的变化漏进来） */
    const excluded: { boardId: string; reason: string }[] = []
    /** ★ 工作包 A：确实没有可比基准的榜（如实说明，而不是静默跳过） */
    const noBaseline: string[] = []
    /** ★ 2026-10-25：批次榜不参与变化（见下方 isBatchBoard） */
    const batchExcluded: string[] = []
    for (const boardId of st.boards as string[]) {
      if (!(st.display as string[]).includes(boardId)) continue
      if (boardId.startsWith('fanqie.derived.')) continue
      const snap = store.readSnapshot(useDate, boardId)
      if (!snap) continue
      const meta = boardMeta(boardId)
      if (isUntrusted(useDate, boardId)) { excluded.push({ boardId, reason: '内容不可信（已隔离）' }); continue }
      /**
       * ★ 2026-10-25：批次榜**整批换新**（刺猬猫首订每周一期、起点图首订每天一批），
       *   批与批之间没有「榜内升降」；把整批新书算成「新入榜/退榜」只会制造假涨退。
       *   它们的内容在「榜单」页按期看，这里明确列为「不参与变化」，而不是静默跳过。
       */
      if (isBatchBoard(boardId)) { batchExcluded.push(boardId); continue }
      /**
       * ★ 工作包 A：逐榜基准（跨过缺日）。缺基准的榜不再「静默跳过且被算成没变化」，
       *   而是进 noBaseline 列表，由 note 如实说明。
       */
      const prevB = previousBoardDate(boardId, useDate, dates)
      if (!prevB) { noBaseline.push(boardId); continue }
      const d: any = diffFor(boardId, useDate, prevB, undefined, slimAll)
      if (d.firstEver) continue
      firstEver = false
      if (d.crossPeriod) { excluded.push({ boardId, reason: '新期不可比（不参与变化）' }); continue }
      const push = (group: string, list: any[], sign: string) => {
        for (const e of list || [])
          entries.push({
            site: meta.site,
            siteName: meta.siteName,
            boardId,
            boardName: meta.name,
            /** ★ 工作包 A：该榜自己的对比基准日（各榜基准可能不同，顶层的 baselineDate 只是汇总） */
            baselineDate: d.baselineDate,
            group,
            title: e.title,
            delta: e.delta == null ? '' : sign + String(e.delta),
            days: e.days == null ? null : e.days,
          })
      }
      push('新入榜', d.newEntry, '第')
      push('回榜', d.rebound, '回榜第')
      push('上升', d.up, '↑')
      push('下降', d.down, '↓')
      push('退榜', d.out, '→ 榜外')
    }
    return {
      date: useDate,
      baselineDate: prevDate,
      firstEver: firstEver && !entries.length,
      count: entries.length,
      sites: groupChanges(entries).map((site) => ({ ...site, groups: site.groups.map((g) => ({ ...g, count: g.items.length })) })),
      /** ★ 工作包 A：同日内数据变化就换 revision（前端不必等跨日） */
      revision: dataRevision(useDate),
      excluded,
      noBaseline,
      batchExcluded,
      note: [
        prevDate ? null : '还没有上一数据日：无基准，不报 0',
        excluded.length ? excluded.length + ' 个榜不参与变化（内容隔离或新期不可比）' : null,
        batchExcluded.length ? batchExcluded.length + ' 个批次榜不参与变化（整批换新，比较无意义）' : null,
        noBaseline.length ? noBaseline.length + ' 个榜没有可比基准（缺更早的可信快照）' : null,
      ].filter(Boolean).join('；') || null,
    }
  }

  /** webServer 服务是可选依赖：用依赖光纤做晚绑定（直取 ctx.webServer 在运行时拿不到 —— T12 验收实测 404） */
  /** 可选榜清单（面板「抓什么」用）：站 → 榜种 → 分类，带是否已勾选 */
  function catalog() {
    const st = readState()
    const captured = new Set(st.boards as string[])
    const shown = new Set(st.display as string[])
    const rows: any[] = []
    const push = (site: string, siteName: string, group: string, boardId: string, label: string) => {
      const cap = site === 'qidian' ? 20 : site === 'sfacg' ? 10 : 100
      rows.push({
        site, siteName, group, boardId, label,
        captured: captured.has(boardId), displayed: shown.has(boardId),
        depth: (st.depths || {})[boardId] ?? defaultDepthFor(boardId),
        maxDepth: cap,
        canDepth: cap > 10,
        depthHint: site === 'qidian' ? '移动端榜单单页固定 20 条（站点分页接口在反爬挑战后面，暂不可调）' : site === 'sfacg' ? '首页 SSR 每个 tab 固定 10 条（不可调）' : site === 'qidiantu' ? '起点图站点自身决定条数（首订当日榜 20–35 条）' : '可调（每页 10 条，翻页取）',
      })
    }
    // 冻结口径：起点「全站」分类不纳入（cat -1 = 全站）
    for (const [name, catId] of Object.entries(QIDIAN_CATEGORIES)) {
      if (Number(catId) < 0 || name === '全站') continue
      push('qidian', '起点', '签约榜', 'qidian.sign.cat' + catId, name)
    }
    push('qidiantu', '起点图', '首订/三江', 'qidiantu.shouding', '首订榜')
    push('qidiantu', '起点图', '首订/三江', 'qidiantu.sanjiang', '三江·推荐效果（周）')
    for (const [catId, name] of FANQIE_MALE) push('fanqie', '番茄', '男频新书榜', 'fanqie.m.new.' + catId, name)
    push('fanqie', '番茄', '派生榜', 'fanqie.derived.period', '在读周榜（本地派生 · 自然周）')
    // 刺猬猫的 CIWEIMAO_BOARDS 里存的是**站点路径**（/rank-index/…）⇒ 标签要用面板同一套名字（boardMeta）
    for (const id of Object.keys(CIWEIMAO_BOARDS)) push('ciweimao', '刺猬猫', '榜单', id, boardMeta(id).name)
    // 刺猬猫「首订（约）」是第三方榜（不在站上）；**必须出现在清单里**，
    // 否则「抓什么」看不到它、保存时会被当成没勾选而丢掉（2026-10-15 修：整表保存丢榜）
    push('ciweimao', '刺猬猫', '第三方', 'ciweimao.buy.latest', '首订（约）· 第三方源')
    for (const [id, meta] of Object.entries(SFACG_BOARDS)) push('sfacg', '菠萝包', '榜单', id, meta.name)
    return {
      defaultCaptures: defaultState().boards,
      boards: rows, captures: st.boards, displays: st.display, depths: st.depths || {}, autoEnrich: st.autoEnrich !== false,
      // 起点书页补全：开关状态 + 缓存规模（面板据此显示「已缓存 N 本 / 截止时间」）
      qidian: { enrich: st.qidianEnrich === true, cache: cacheStats(root), ttlDays: Math.round(QIDIAN_CACHE_TTL_MS / 86400000) },
      /**
       * ★ 2026-10-17（3）：全局最小请求间隔（真实请求通道；默认 1000ms）。
       * 面板据此显示并允许下调 —— 这是**我们自己定的保守值**，不是站点要求。
       */
      requestIntervalMs: minRequestIntervalMs(),
      // ★ 2026-10-17：通用书页缓存（刺猬猫/菠萝包/番茄）——面板显示规模与 TTL
      bookCache: { stat: bookCacheStats(root), ttlDays: Math.round(BOOK_CACHE_TTL_MS / 86400000) },
      // 定时设置（面板「抓什么」页可改；**默认开**，用户可关，见 defaultState）
      timer: {
        enabled: st.timerEnabled === true,
        scanTime: st.scanTime,
        /** ★ 按站分时（2026-10-16）：面板「抓什么」页按站显示时刻 + 今天跑没跑 */
        siteTimes: (st as any).siteTimes || DEFAULT_SITE_TIMES,
        fallbackTime: (st as any).fallbackTime || DEFAULT_FALLBACK_TIME,
        siteLastRun: (st as any).siteLastRun || {},
        plan: timerPlanNow(),
        freshMs: timerFreshMs,
        lastRun: st.lastTimerRun || null,
        lastRunAt: st.lastTimerRunAt || null,
        lastState: st.lastTimerState || null,
        lastNote: st.lastTimerNote || null,
        wired: timerState.wired,
        inFlight: timerState.scanInFlight,
        /** ★ 2026-10-17：后台补全工人 —— 面板据此显示「补全中 N/M」，active=false 表示已收工 */
        enrichRun: (st as any).enrichRun ? { ...(st as any).enrichRun, active: timerState.enrichWorker } : null,
        enrichPending: Object.keys(((st as any).enrichPending) || {}).length,
        enrichWorker: timerState.enrichWorker,
      },
    }
  }

  /**
   * ★ 票 30：扫描锁。定时与手动共用同一把（`timerState.scanInFlight`），拿不到就返回 409。
   * 旧实现里手动 `/scan` **只查不置位** ⇒ 并发第二发打到文件锁上、报 500（语义错），
   * 面板也看不出来是「已经在跑」。
   */
  async function withScanLock<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    if (timerState.scanInFlight) return { ok: false }
    timerState.scanInFlight = true
    try { return { ok: true, value: await run() } } finally { timerState.scanInFlight = false }
  }

  /** 读 POST body（面板按钮用，JSON；有上限防滥用） */
  async function readBody(req: any): Promise<any> {
    if (req.body && typeof req.body === 'object') return req.body
    return await new Promise((resolve) => {
      // ★ 票 30：半开连接保护 —— 客户端既不 end 也不 error 时，旧实现永不 settle（请求悬挂、连接常驻）。
      let settled = false
      const done = (v: any) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v) } }
      const timer = setTimeout(() => done({}), 10_000)
      let raw = ''
      try {
        if (typeof req.setEncoding === 'function') req.setEncoding('utf8')
        req.on('data', (c: any) => { raw += String(c); if (raw.length > 65536) raw = raw.slice(0, 65536) })
        req.on('end', () => { try { done(raw ? JSON.parse(raw) : {}) } catch { done({}) } })
        req.on('error', () => done({}))
      } catch { done({}) }
    })
  }

  /**
   * 按需补全某榜当天快照的字段（不重扫榜）：
   * - 起点：逐本反查书页 ⇒ 精确字数 + 收藏（适配器内置 enrich）
   * - 番茄：逐本打 /api/book/info ⇒ 干净书名/作者（站点字体反爬缺字）+ 字数
   * 结果**就地覆盖**当天该榜快照与当天 scan.json 里该榜的 rows（幂等，同一天可重复补）。
   * 已知不支持：刺猬猫/菠萝包（详情页需另写解析，v1 未做）⇒ 明确回话，不静默。
   */
  /**
   * 起点榜单补「收藏 + 精确字数」——起点收藏**只能**从作品页拿（榜页没有、没有 bulk 接口）。
   * 靠 state/qidian-book-cache.json 的 TTL 缓存跳过已抓过的书：
   *   命中 ⇒ 0 请求；未命中/过期 ⇒ 1 请求（书页 ≈103 KB，1s 限速）。
   * budget 上限是安全阀：一次调用最多打这么多请求，超了剩下的交给下次/缓存慢慢收。
   */
  async function qidianEnrichBoard(boardId: string, force = false, budget = QIDIAN_ENRICH_BUDGET): Promise<any> {
    const st = readState()
    const store = new FileStore(root)
    const dates = listDataDates(root)
    const date = dates[dates.length - 1]
    if (!date) return { ok: false, error: '还没有任何快照，先扫一次' }
    const snap = store.readSnapshot(date, boardId)
    if (!snap || !snap.rows || !snap.rows.length) return { ok: false, error: '这个榜当天没有快照或没有条目' }
    /**
     * 支持两类榜：
     * - `qidian.*`：起点自己的榜 —— 补「精确字数 + 收藏」；
     * - `qidiantu.*`（起点图）：书号就是起点书号，三江表里**没有字数字段**，
     *   所以同样靠起点书页取「字数」——但**只取字数，不覆盖它自己的收藏**（口径不同）。使用者 2026-10-15。
     */
    const isQd = boardId.startsWith('qidian.')
    const isQdt = boardId.startsWith('qidiantu.')
    if (!isQd && !isQdt) return { ok: false, error: '只支持起点 / 起点图的榜（字数与收藏只在起点作品页里）' }
    // 起点图的书号也是起点书号 ⇒ 书页一律用起点移动端适配器取
    const site: any = isQd ? sitesFor([boardId], st.depths || {})[0] : makeQidianMobileSite({ boardIds: ['sign-cat-all'] })
    if (!site || typeof site.fetchBookStats !== 'function') return { ok: false, error: '起点适配器没有 fetchBookStats' }
    const ctxBoard = { now: () => clock.now(), signal: new AbortController().signal, requestTimeoutMs: 15000 }
    /**
     * ★ 起点图只补「字数」，**绝不动它的 collect**（2026-10-15）：
     *   三江的 collect 是**起点图口径**（期初收藏），与起点作品页的收藏不是同一个数；
     *   若照起点那样连 collect 一起覆盖，三江的「期初收藏」会被悄悄换掉 ⇒ 口径污染。
     */
    const mergeStat = (row: any, stx: { collect: number | null; wordsCnt: number | null }, from: string, at: string) => ({
      ...row,
      extra: isQdt
        ? { ...(row.extra || {}), wordsCnt: stx.wordsCnt, wordsFrom: from, wordsAt: at }
        : { ...(row.extra || {}), collect: stx.collect, wordsCnt: stx.wordsCnt, statsFrom: from, statsAt: at },
    })

    let requests = 0
    let hits = 0
    let misses = 0
    let failed = 0
    const pending: { key: string; collect: number | null; wordsCnt: number | null; title: string | null }[] = []
    const out: any[] = []
    for (let i = 0; i < snap.rows.length; i++) {
      const row = snap.rows[i]
      const key = String(row.key)
      const cached = force ? { hit: false, hitAt: null, stat: null } : cachedBook(root, key, QIDIAN_CACHE_TTL_MS)
      if (cached.hit && cached.stat) {
        hits += 1
        out.push(mergeStat(row, cached.stat, 'cache', String(cached.stat.fetchedAt || '')))
        continue
      }
      if (requests >= budget) { out.push(row); continue }   // 预算用完：本轮不打，保持原样（下次继续收）
      // ★ 2026-10-17（1）：**删掉这里的显式 1s sleep** —— 下面的请求走 rateLimit 闸门，
      //   闸门本身已保证「相邻真实请求 ≥1s」。原来 sleep + 闸门 = 实测每条约 2s（30 本 33 秒）。
      requests += 1
      try {
        const stx = await site.fetchBookStats(key, ctxBoard)
        misses += 1
        pending.push({ key, collect: stx.collect, wordsCnt: stx.wordsCnt, title: null })
        out.push(mergeStat(row, stx, 'book-page', new Date().toISOString()))
      } catch (e) {
        failed += 1
        out.push(row)   // 失败保持原样，且**不写缓存**（下次重试）
      }
    }
    const saved = putCachedBooks(root, pending)
    // 就地覆盖当天快照 + 当天记录（幂等，与 enrichBoard 同款）
    await store.writeSnapshot({ boardId, dataDate: date, metric: snap.metric || 'value', rows: out })
    const rec: any = await store.readScan(date)
    if (rec) {
      const row = (rec.boards || []).find((x: any) => x.boardId === boardId)
      if (row) { row.rows = out; await store.writeScan(rec) }
    }
    return {
      ok: true, boardId, date, total: out.length,
      cacheHit: hits, fetched: misses, failed, requests, cached: saved,
      budgetHit: requests >= budget && hits + misses + failed < out.length,
      note: (isQdt ? '起点图字数' : '起点收藏') + '：命中缓存 ' + hits + ' 本、新打 ' + misses + ' 本（' + requests + ' 请求）、失败 ' + failed + ' 本' +
        (saved ? '；已写入缓存 ' + saved + ' 本' : ''),
    }
  }

  async function enrichBoard(boardId: string, force = false, budget?: number) {
    const st = readState()
    const store = new FileStore(root)
    const dates = listDataDates(root)
    const date = dates[dates.length - 1]
    if (!date) return { ok: false, error: '还没有任何快照，先扫一次' }
    const snap = store.readSnapshot(date, boardId)
    if (!snap || !snap.rows || !snap.rows.length) return { ok: false, error: '这个榜当天没有快照或没有条目' }
    const ctxBoard = { now: () => clock.now(), signal: new AbortController().signal, requestTimeoutMs: 15000 }
    let out = { rows: snap.rows, requests: 0 }
    if (boardId.startsWith('qidian.') || boardId.startsWith('qidiantu.')) {
      /**
       * ★ 2026-10-16（补全持久化）：起点改走**书页缓存那条通道**（qidianEnrichBoard）——它按行命中缓存，
       *   续跑时只打「没缓存/缓存过期」的书；旧实现走适配器内置 enrich（无缓存），每次续跑都把整榜重打。
       *   它返回 {ok:false} 时（例如没有快照）才退回内置 enrich，保持旧行为。
       *
       * ★ 2026-10-17（发布前修）：**起点图（三江）也并进这条通道**。三江表里没有字数字段，
       *   它的字数同样只能从起点书页取（`qidianEnrichBoard` 的 isQdt 分支只补 wordsCnt、不动它自己的 collect）。
       *   以前这里只判 `qidian.` ⇒ 续跑工人与面板「补全本榜」对三江直接落到兜底
       *   「这个榜暂不支持补全」：**一次真实请求都没打，tried 却照加** ⇒ 3 次后永久显示「补全未完成」，
       *   概览顶部横幅也一直挂着「还剩 1 个榜」。能补三江的通道本来就有，只是没接上。
       */
      const rq: any = await qidianEnrichBoard(boardId, force, budget)
      if (rq && rq.ok) return rq
      // 三江没有「适配器内置 enrich」那条路：取不到就如实报错，不再假装尝试过一次
      if (!boardId.startsWith('qidian.')) return { ok: false, error: (rq && rq.error) || '起点图书页取字数失败' }
      const site: any = sitesFor([boardId], st.depths || {})[0]
      if (!site || typeof site.enrich !== 'function') return { ok: false, error: (rq && rq.error) || '起点适配器没有 enrich' }
      out = await site.enrich(boardId, snap.rows, ctxBoard)
    } else if (boardId.startsWith('fanqie.')) {
      // 只补「仍有私用区码点 / 仍标可疑 / 没书名」的行：学到映射表后大部分行不必再请求
      // ★ 2026-10-16（补全持久化）：只把**还需要**的行送进请求循环 —— 续跑时已补好的行不再占预算。
      const need = snap.rows.filter((r: any) => {
        const e = r.extra || {}
        return !r.title || e.titleSuspect !== false || hasPua(r.title) || hasPua(r.author)
      })
      const got = need.length ? await enrichFanqieTitles(need, ctxBoard, budget ?? enrichBudgetForBoard(boardId)) : ({ rows: [], requests: 0 } as any)
      const byKey = new Map((got.rows || []).map((r: any) => [String(r.key), r]))
      out = { rows: snap.rows.map((r: any) => (byKey.has(String(r.key)) ? byKey.get(String(r.key)) : r)), requests: got.requests } as any
    } else if (boardId === 'ciweimao.buy.latest') {
      /**
       * 第三方「首订（约）」榜（源：newmmapi.yukirus.com，只有 约值首订 + 上架时间，没有字数/收藏）。
       * 使用者 2026-10-15：**要显示字数与收藏** ⇒ 走刺猬猫书页补全同一套解析。
       * 这里刻意**不**抄通用 ciweimao 分支、也不再提前 return：
       *   ① 先把来源页补进每条（面板要用它跳第三方原始页）；
       *   ② 再逐本进刺猬猫书页取 字数/收藏 —— 与别的刺猬猫榜同一个口径。
       * 口径提示：同一行里「首订（约）」是第三方约值，字数/收藏是刺猬猫书页当天的值，**不同源**。
       */
      const withSource = snap.rows.map((r: any) => ({ ...r, extra: { ...(r.extra || {}), sourceUrl: CIWEIMAO_BUY_URL, sourcePage: 'http://www.yukirus.com/' } }))
      const filled = await enrichBookPages(withSource, ctxBoard, 'ciweimao', force, budget ?? enrichBudgetForBoard(boardId))
      out = { rows: filled.rows, requests: filled.requests } as any
    } else if (boardId.startsWith('ciweimao.')) {
      out = await enrichBookPages(snap.rows, ctxBoard, 'ciweimao', force, budget ?? enrichBudgetForBoard(boardId))
    } else if (boardId.startsWith('sfacg.')) {
      out = await enrichBookPages(snap.rows, ctxBoard, 'sfacg', force, budget ?? enrichBudgetForBoard(boardId))
    } else {
      return { ok: false, error: '这个榜暂不支持补全' }
    }
    /**
     * ★ 2026-10-16（补全持久化）：这一次一个字段都没补上就不写盘。
     *   否则续跑会把 snapshot mtime 一直往前推，看不出「这条其实早就放弃了」。
     */
    if (JSON.stringify(out.rows) === JSON.stringify(snap.rows)) {
      return { ok: true, boardId, filled: 0, total: out.rows.length, requests: out.requests || 0, note: '本次没有新补上的字段（已是当前最好结果）' }
    }
    await store.writeSnapshot({ boardId, dataDate: date, metric: snap.metric, rows: out.rows })
    // 同步当天 scan.json 里该榜的 rows（保持「快照 = 记录」一致）
    const rec: any = await store.readScan(date)
    if (rec) {
      const b = (rec.boards || []).find((x: any) => x.boardId === boardId)
      if (b) { b.rows = out.rows; await store.writeScan(rec) }
    }
    // 只把「书名已非可疑」（或拿到精确字数/收藏）算作补到
    const got = (r: any) => { const e = r.extra || {}; return e.titleSuspect === false || e.wordsCnt != null || e.collect != null }
    const filled = out.rows.filter(got).length
    return { ok: true, boardId, filled, total: out.rows.length, requests: out.requests, note: '已补 ' + filled + '/' + out.rows.length + ' 条（' + out.requests + ' 请求）' }
  }

  /**
   * ★ 2026-10-16（补全持久化）：记「这一榜还缺补全」。
   * 只有**确实还缺**（enrichMissingCount > 0）才记；补齐后调用点会删掉条目。
   * 必须带**数据日期**：跨日后旧条目自动作废（补全只针对最近一个数据日）。
   */
  function markEnrichPending(date: string, boardId: string): void {
    try {
      const s = readState()
      const p: any = { ...((s as any).enrichPending || {}) }
      const prev = p[boardId]
      p[boardId] = { date, tried: prev && prev.date === date ? (prev.tried || 0) : 0 }
      ;(s as any).enrichPending = p
      writeState(s)
    } catch { /* 记待办失败不影响扫描 */ }
  }

  /** 最近一个数据日（补全永远只针对它；没有快照时返回空串） */
  function latestDataDate(): string {
    const ds = listDataDates(root)
    return ds[ds.length - 1] || ''
  }

  /** 该榜的补全已完整 ⇒ 清掉待办（成功路径） */
  function clearEnrichPending(boardId: string): void {
    try {
      const s = readState()
      const p: any = { ...((s as any).enrichPending || {}) }
      if (!p[boardId]) return
      delete p[boardId]
      ;(s as any).enrichPending = p
      writeState(s)
    } catch { /* 同上 */ }
  }

  function needsEnrichRows(boardId: string, rows: any[]): number {
    return enrichMissingCount(boardId, (rows || []) as any)
  }

  /**
   * ★ 2026-10-17（发布前修）：**还能续跑的**补全待办数（tried < 每榜每日上限）。
   *   面板顶部横幅以前按「上一轮的 total - done」算 ⇒ 「当日已试满、今天不再跑」的榜也被写成
   *   「等下一次续跑」，于是横幅永远挂着。这里跟续跑判定（enrichAttemptPolicy）用同一把尺子。
   *   日期对不上的条目按 1 记（它会被 stale 清掉，或有新一天的快照等着补）。
   */
  function retryablePendingCount(): number {
    try {
      const pe: any = (readState() as any).enrichPending || {}
      const latest = latestDataDate()
      let n = 0
      for (const b of Object.keys(pe)) {
        const rec = pe[b]
        if (!rec || rec.date !== latest) { n += 1; continue }
        if ((rec.tried || 0) < ENRICH_TRIES_PER_DAY) n += 1
      }
      return n
    } catch { return 0 }
  }

  /**
   * ★ 2026-10-17（补全移出阻塞路径）：后台补全工人。
   * 由「手动扫描收尾」与定时 tick 启动：延迟 3 秒起跑（让 /scan 的响应先出去），
   * 逐个补 pending 里的榜，每次最多 ENRICH_RUN_REQUEST_CAP 个请求，跑完即退出。
   * 进度写 state.enrichRun，面板据此显示「补全中 N/M」；单榜判定仍走 enrichAttemptPolicy。
   */
  function startEnrichWorker(reason: string): void {
    if (timerState.enrichWorker) return
    /**
     * ★ 2026-10-17（同一毛病在另一个入口）：任何调用点起工人前都先问「还有可续跑的榜吗」；
     *   没有就直接返回、**完全不碰 enrichRun** —— 否则每次起跑都会把 active 置真再立刻置假，
     *   面板横幅就跟着闪（30 秒一轮）。
     */
    if (retryablePendingCount() === 0) return
    timerState.enrichWorker = true
    const startedAt = new Date().toISOString()
    const st0 = readState()
    const total0 = Object.keys(((st0 as any).enrichPending) || {}).length
    try {
      st0.enrichRun = { startedAt, done: 0, total: total0, active: true, note: reason }
      writeState(st0)
    } catch { /* 进度写失败不影响补全 */ }
    const timer = timerApi && typeof (timerApi as any).setTimeout === 'function'
      ? (timerApi as any).setTimeout.bind(timerApi)
      : (typeof setTimeout === 'function' ? setTimeout : null)
    const run = async () => {
      let done = 0
      let requests = 0
      try {
        const st = readState()
        const pending: any = (st as any).enrichPending || {}
        const ids = Object.keys(pending)
        const dates = listDataDates(root)
        const latest = dates[dates.length - 1]
        const store = new FileStore(root)
        if (latest) {
          for (const b of ids) {
            if (requests >= ENRICH_RUN_REQUEST_CAP) break
            const rec = pending[b]
            if (!rec || rec.date !== latest) { clearEnrichPending(b); continue }
            const snap: any = store.readSnapshot(latest, b)
            if (!snap || !(snap.rows || []).length) { clearEnrichPending(b); continue }
            const before = needsEnrichRows(b, snap.rows)
            const pol = enrichAttemptPolicy({
              pendingDate: rec.date, latestDate: latest, missing: before,
              tried: rec.tried || 0, maxTries: ENRICH_TRIES_PER_DAY, enrichable: isEnrichableBoard(b),
            })
            if (pol.action === 'clear' || pol.action === 'stale') { clearEnrichPending(b); continue }
            if (pol.action === 'giveup') continue
            // 先落盘尝试计数：即使随后被取消/进程死掉也不会无限重试
            try {
              const s2 = readState()
              const p2: any = { ...((s2 as any).enrichPending || {}) }
              if (p2[b] && p2[b].date === latest) { p2[b] = { date: latest, tried: (rec.tried || 0) + 1 }; (s2 as any).enrichPending = p2; writeState(s2) }
            } catch { /* 计数失败不阻塞 */ }
            let res: any = null
            try {
              /**
               * ★ 2026-10-17（审查续核 ⑥）：单榜预算与「一轮总闸」取小 ⇒ 一轮真实请求数**不会**超总闸
               * （单榜 24/40 都小于总闸 60，所以以前那个「最多冲到 84」其实到不了；写成 min 是让这个界显式）。
               */
              res = await enrichBoard(b, false, Math.min(ENRICH_RUN_REQUEST_CAP - requests, enrichBudgetForBoard(b)))
              requests += (res && typeof res.requests === 'number') ? res.requests : 0
            } catch (e) {
              timerLog('后台补全失败 ' + b + '：' + String(e).slice(0, 100))
            }
            /**
             * ★ 2026-10-17（额度被「能力缺口」烧掉）：enrichBoard 明确说「这个榜暂不支持补全」时，
             *   这一轮**一个真实请求都没打**，不该记一次尝试 —— 否则一个没接上补全通道的榜
             *   3 次就把当天的额度烧完，从此每天都是「当日已试满、明天再续」，永远补不上。
             *   把刚才预扣的那一次退回去（日期对得上才退）。
             */
            try {
              const err01 = res && res.ok === false ? String(res.error || '') : ''
              if (err01.indexOf('暂不支持') >= 0) {
                const s5 = readState()
                const p5: any = { ...((s5 as any).enrichPending || {}) }
                if (p5[b] && p5[b].date === latest && (p5[b].tried || 0) > 0) {
                  p5[b] = { date: latest, tried: (p5[b].tried || 0) - 1 }
                  ;(s5 as any).enrichPending = p5
                  writeState(s5)
                  timerLog('补全通道不支持，退回一次尝试额度：' + b)
                }
              }
            } catch { /* 退额度失败不影响主流程 */ }
            done += 1
            try {
              const s3 = readState()
              s3.enrichRun = { startedAt, done, total: ids.length, active: true, note: reason }
              writeState(s3)
            } catch { /* 同上 */ }
            const after: any = store.readSnapshot(latest, b)
            if (!needsEnrichRows(b, (after && after.rows) || [])) clearEnrichPending(b)
          }
        }
      } finally {
        try {
          const s4 = readState()
          const left = Object.keys(((s4 as any).enrichPending) || {}).length
          // ★ 2026-10-17（发布前修）：note 说清「还剩」到底是「还能续跑」还是「当日已试满」，
          //   否则面板/日志会把 giveup 的榜说成「等下一次续跑」（今天根本不会再跑）。
          const again = retryablePendingCount()
          const tail = left
            ? (again > 0 ? '（还剩 ' + left + ' 个榜，等下一次续跑）' : '（还剩 ' + left + ' 个榜，当日已试满，明天再续）')
            : ''
          s4.enrichRun = { startedAt, done, total: done + left, active: false, note: reason + tail }
          writeState(s4)
        } catch { /* 同上 */ }
        timerState.enrichWorker = false
        if (done > 0 || requests > 0) timerLog('后台补全完成：' + done + ' 个榜、' + requests + ' 请求（' + reason + '）')
      }
    }
    if (timer) timer(run, 3000)
    else void run()
  }


  /** 批量补全：把某个站已抓的、当天有快照的榜逐个补一遍（番茄用于一次性洗掉全部分类的乱码） */
  async function enrichAll(site: string) {
    const st = readState()
    const prefix = site === 'fanqie' ? 'fanqie.m.' : site === 'qidian' ? 'qidian.' : site + '.'
    const boards = (st.boards as string[]).filter((b) => b.startsWith(prefix))
    if (!boards.length) return { ok: false, error: '抓取集里没有这个站的榜：' + site }
    const results: any[] = []
    let totalFilled = 0
    let totalReq = 0
    // ★ 票 30：批量补全加**时长上限**（旧实现一个 HTTP 请求串行跑完某站全部榜 ⇒ 面板只能转圈，
    //   每榜最多 25 请求 × 1s，最坏能阻塞几分钟到十几分钟）。到点就停，并如实回报停在哪。
    const t0 = Date.now()
    const skipped: string[] = []
    for (const b of boards) {
      if (Date.now() - t0 > BATCH_ENRICH_CAP_MS) { skipped.push(b); continue }
      try {
        const r: any = await enrichBoard(b)
        results.push({ boardId: b, ok: !!r.ok, filled: r.filled || 0, total: r.total || 0, requests: r.requests || 0, error: r.error || null })
        totalFilled += r.filled || 0
        totalReq += r.requests || 0
      } catch (e) {
        results.push({ boardId: b, ok: false, error: String(e).slice(0, 80) })
      }
    }
    if (skipped.length) ctx.logger?.info?.('[' + name + '] 批量补全到点停止，跳过 ' + skipped.length + ' 个榜：' + skipped.join(','))
    return { ok: true, site, boards: results.length, filled: totalFilled, requests: totalReq, skipped, stoppedByTime: skipped.length > 0, note: (skipped.length ? '已到 ' + Math.round(BATCH_ENRICH_CAP_MS / 60000) + ' 分钟上限，跳过 ' + skipped.length + ' 个榜；' : '') + '已补 ' + totalFilled + ' 条（' + results.length + ' 个榜 · ' + totalReq + ' 请求）', detail: results }
  }

  /**
   * 刺猬猫 / 菠萝包 逐本进书页补 字数/收藏/评分/书名（榜单页只给前 2 条，其余为空）：
   * - 刺猬猫 <p class="book-grade">总点击：<b>70.9万</b> 总收藏：<b>5573</b> 总字数：<b>116074</b></p>
   * - 菠萝包 书页含 字数：97862 / 收藏：1276
   * 1s/请求（采集纪律）
   */
  async function enrichBookPages(rows: any[], ctxBoard: any, kind: 'ciweimao' | 'sfacg', force = false, budget = 24): Promise<{ rows: any[]; requests: number }> {
    const out: any[] = []
    let requests = 0
    /** ★ 2026-10-17：本榜补全的缓存命中数（写进 note，便于面板/日志看出省了多少请求） */
    let cacheHits = 0
    /** 本榜要回写缓存的条目（循环结束一次性原子写） */
    const pendingEntries: { site: string; bookId: string; entry: any }[] = []
    const ua = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9' }
    const numOf = (s: string | null | undefined): number | null => {
      if (s == null) return null
      // 注意：这里刻意只用 [0-9] 这类不含反斜杠的写法（d/s 曾在本文件里被吃掉，导致一律解析成 0）
      const t = String(s).split(',').join('').split(' ').join('')
      if (!/[0-9]/.test(t)) return null
      const m = t.match(/^([0-9.]+)万$/)
      if (m) return Math.round(Number(m[1]) * 10000)
      const digits = t.replace(/[^0-9.]/g, '')
      const n = Number(digits)
      return Number.isFinite(n) && digits !== '' ? n : null
    }
    for (const r of rows) {
      const next = { ...r, extra: { ...(r.extra || {}) } }
      // let（不是 const）：贴缓存后 next.extra 会被换成新对象，e 要跟着指向那个活对象
      let e = next.extra as any
      /**
       * ★ 2026-10-17（书页缓存）：命中即用，0 请求。
       *   现状是「换一天就是全新裸行」⇒ 每天把 60 本书页全部重打一遍；实测这些书号 88% 与前一天重合。
       *   命中时只补**还缺**的字段（已有 collect 的行仍会去取字数并写回缓存）。
       */
      const bid = bookIdFromUrl(String(r.url || ''))
      const cached = !force && bid ? cachedEntry(root, kind, bid, BOOK_CACHE_TTL_MS) : { hit: false, entry: null as any }
      if (cached.hit && cached.entry) {
        const ce: any = cached.entry
        // 贴缓存能给的字段并判「够不够」（纯函数在 scan/book-cache.ts，有单测）
        const c5 = assignCachedStats(e, kind, { collect: ce.collect, words: ce.words, title: ce.title, author: ce.author, score: ce.score })
        next.extra = c5.extra as any
        /**
         * ★ 2026-10-17（审查续核 ③）：`e` 是上面捕获的**旧** extra 对象；既然 next.extra 换成了新对象，
         * 后面那些溯源标记（fromBookPage / statsFrom / statsAt / collectWordsFilled）必须写到新对象上。
         * 原来写旧 `e` ⇒ 溯源全丢，且 `need = force || e.fromBookPage !== true` 恒真 ⇒ 下次补全又为同一行进一次书页。
         */
        e = next.extra as any
        // 书名/作者也缓存了：榜单页截断/空值时用缓存补全（0 请求）
        if (ce.title && (!next.title || e.titleTruncated === true)) { next.title = ce.title; (next.extra as any).titleTruncated = false }
        if (ce.author && !next.author) next.author = ce.author
        /**
         * ★ 2026-10-17（审查阻塞 5）：**缓存给不全就不算命中**。
         * 缓存按「真取到哪个写哪个」合并，完全可能只有 collect 没有 words；
         * 旧写法命中就置 fromBookPage=true ⇒ 这行以后永远命中同一份半残缓存、永不再发请求，
         * 而面板/待办仍把它算成缺字段 ⇒ 待办永不清、每榜每日额度全花在空转上。
         */
        if (c5.sufficient) {
          cacheHits += 1
          e.fromBookPage = true
          e.collectWordsFilled = true
          e.statsFrom = 'book-page-cache'
          e.statsAt = ce.fetchedAt
          out.push(next)
          continue
        }
      }
      /**
       * ★ 2026-10-17（审查阻塞 1）：**请求预算必须在这层生效**。
       * 以前 budget 只传到起点的缓存通道，ciweimao/sfacg/番茄是「传了但没人看」⇒
       * 一个 60 行的榜能一把打 60 请求，工人那层的上限只在**每榜开始前**检查，形同虚设。
       * 到额就保留原行、不再发请求（下一次补全/续跑接着补）。
       */
      if (requests >= budget) { out.push(next); continue }
      // force = 同一份快照上重跑也重新取（用于口径修正后回填）
    // 菠萝包**一律以书页为准**：首页 SSR 的数字是另一个口径（实测同一本 首页 165 / 详情页 1280）
    // ★ 2026-10-16：两个分支原本写的是同一个表达式（恒等三元），去掉误导；语义不变 = 「没从书页取过才取」
    const need = force || e.fromBookPage !== true
      if (r.url && need) {
        try {
          // ★ 2026-10-17（1）：删掉显式 1s sleep —— 下面的请求带 rateLimit 闸门，闸门已保证相邻真实请求 ≥1s；
          //   原来 sleep + 闸门叠成实测每条约 2s。
          const resp = await boundedFetch(String(r.url), { rateLimit: true, timeoutMs: 15000, signal: ctxBoard.signal, headers: ua as any })
          requests += 1
          const html = await (resp as any).text()
          // ★ 2026-10-16（使用反馈「刺猬猫补不上字数/收藏」）：只有**真解析出数值**才把这一行标成
          //   「已从书页取过」。原来无论解析成功与否都置 fromBookPage=true ⇒ 页面结构一变，
          //   这些行被判「已抓」，不传 force 就永久补不上。
          let got = false
          if (kind === 'ciweimao') {
            // 只认 book-grade 段落里的那三个数（页面别处可能有 0 占位模板）
            const blk = html.match(/class="book-grade"[\s\S]{0,400}?<\/p>/)
            const seg = blk ? blk[0] : html
            const g = seg.match(/总点击：<b>([^<]*)<\/b>[\s\S]{0,40}?总收藏：<b>([^<]*)<\/b>[\s\S]{0,40}?总字数：<b>([^<]*)<\/b>/)
            if (!g) {
              const at = html.indexOf('总收藏')
              e.enrichDebug = 'len=' + html.length + ' grade=' + !!blk + ' n=' + (html.match(/总收藏/g) || []).length + ' ctx=' + (at >= 0 ? html.slice(at, at + 50).split(String.fromCharCode(10)).join(' ') : 'none')
            }
            if (g) {
              e.clicks = numOf(g[1])
              e.collect = numOf(g[2])
              e.wordsCnt = numOf(g[3])
              e.collectWordsFilled = true
              got = true
            } else {
              const c = seg.match(/总收藏：<b>([^<]*)<\/b>/)
              if (c) { e.collect = numOf(c[1]); got = e.collect != null || got }
              const w = seg.match(/总字数：<b>([^<]*)<\/b>/)
              if (w) { e.wordsCnt = numOf(w[1]); got = e.wordsCnt != null || got }
            }
            if (!got) e.enrichError = '书页里没解析出总收藏/总字数（页面结构可能变了）'
            // ★ 2026-10-17：真解析出的字段回写书页缓存（只写本次真取到的，别把历史值当新值）
            if (bid && got) {
              pendingEntries.push({
                site: kind,
                bookId: bid,
                entry: {
                  collect: g ? numOf(g[2]) : null,
                  words: g ? numOf(g[3]) : null,
                  title: null,
                  author: null,
                  score: null,
                },
              })
            }
            const t = html.match(/<title>([^<]{1,60})/)
            if (t && r.title && String(r.title).replace(/[\s…]/g, '').length <= String(t[1]).length) next.title = String(t[1]).replace(/最新章节.*$/, '').trim()
          } else {
            // 菠萝包书页有两组数字，口径必须区分（2026-10-15 使用者实测发现）：
            //   「收藏 1280」= 总收藏（按钮）；「收藏：166」= 统计块里的另一个口径（别用）
            //   「字数：99784字[连载中]」= 总字数；「字数：26321」= 另一口径（别用）
            const w = html.match(/字数[：:]\s*([\d,]+)\s*字/)
            const c = html.match(/>收藏\s*([\d,]+)\s*</) || html.match(/id="J_BookCollectCount"[^>]*>\s*([\d,]+)/)
            const s = html.match(/([\d.]+)\s*分/)
            if (w) { e.words = numOf(w[1]); got = e.words != null || got }
            if (c) { e.collect = numOf(c[1]); got = e.collect != null || got }
            if (s) { e.score = Number(s[1]); got = Number.isFinite(e.score) || got }
            if (!got) e.enrichError = '书页里没解析出字数/收藏（页面结构可能变了）'
            // 书名：页面标题是「书名 - 小说全文阅读 - 分类 - 作者 - SF轻小说」⇒ 截到第一个 ' - '
            const t = html.match(/<title>([^<]{1,120})<\/title>/)
            if (t) {
              const clean = String(t[1]).split(' - ')[0].trim()
              if (clean) { next.title = clean; e.titleTruncated = false }
              /**
               * 作者：菠萝包**首页榜给不出**（1–2 名是图文卡，只有评分/字数/收藏；3+ 名连数值都没有），
               * 所以适配器里 author 恒为 null。但书页 <title> 里有 —— 实测（2026-10-15 取 783717 页）：
               *   「越狱失败后成了典狱长小姐的玩物 - 小说全文阅读 - 纯爱运动女性主角变身橘味 - 日升之时 - SF轻小说」
               * ⇒ 按 ' - ' 取**倒数第二段**（'SF轻小说' 前一段）；段数不合预期时用正则兜底。
               */
              const author = authorFromBookTitle(String(t[1]))
              if (author) next.author = author
            }
            // 只在真拿到数时标记「已从书页取过」；否则留待下次（或 force）重试
            if (got) e.fromBookPage = true
            // ★ 2026-10-17：回写书页缓存（字数/收藏/评分 + 干净书名与作者）
            if (bid && got) {
              pendingEntries.push({
                site: kind,
                bookId: bid,
                entry: {
                  collect: c ? numOf(c[1]) : null,
                  words: w ? numOf(w[1]) : null,
                  title: next.title || null,
                  author: next.author || null,
                  score: s ? Number(s[1]) : null,
                },
              })
            }
          }
        } catch (err) {
          e.enrichError = String(err).slice(0, 60)
        }
      }
      out.push(next)
    }
    if (pendingEntries.length) putEntries(root, pendingEntries)
    return { rows: out, requests, cacheHits } as any
  }

  /** 番茄逐本补：/api/book/info?bookId= ⇒ 干净书名/作者 + 字数 */
  async function enrichFanqieTitles(rows: any[], ctxBoard: any, budget = 24): Promise<{ rows: any[]; requests: number }> {
    const out: any[] = []
    let requests = 0
    let learned = 0
    const fontMap = loadFontMap(root)
    // ★ 2026-10-17：干净书名/作者/字数一律先查书页缓存 —— 字体映射是「逐条学」的，
    //   换一天又是新的私用区码点 ⇒ 没缓存就每天把整榜重打一遍（实测这些书号 88% 与前一天重合）。
    let cacheHits = 0
    const pendingEntries: { site: string; bookId: string; entry: any }[] = []
    for (const r of rows) {
      let next = { ...r, extra: { ...(r.extra || {}) } }
      const bid = String(r.key || '')
      const ce = bid ? cachedEntry(root, 'fanqie', bid, BOOK_CACHE_TTL_MS) : { hit: false, entry: null as any }
      if (ce.hit && ce.entry) {
        const e0: any = ce.entry
        if (e0.title) { next.title = e0.title; next.extra.titleSuspect = false; next.extra.titleFrom = 'book-page-cache' }
        if (e0.author) next.author = e0.author
        if (e0.words != null) next.extra.wordNumber = e0.words
        /**
         * ★ 2026-10-17（审查阻塞 5 的番茄分支）：番茄这一路要的就是**书名 + 字数**两件。
         * 缓存给不全就落回真实请求 —— 否则「只缓存到书名」的行会被永久标成已补，字数字段永远空着。
         */
        if (next.title && next.extra.wordNumber != null) {
          cacheHits += 1
          next.extra.statsFrom = 'book-page-cache'
          out.push(next)
          continue
        }
      }
      // ★ 2026-10-17（审查阻塞 1）：番茄这层同样吃请求预算（到额保留原行，下次续跑接着补）
      if (requests >= budget) { out.push(next); continue }
      try {
        // ★ 2026-10-17（1）：显式 sleep 删除，节拍交给 rateLimit 闸门
        const resp = await boundedFetch('https://fanqienovel.com/api/book/info?bookId=' + encodeURIComponent(String(r.key)), {
          rateLimit: true, timeoutMs: 15000, signal: ctxBoard.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
        })
        requests += 1
        const json: any = await (resp as any).json()
        const d = json && json.data
        const info = d && (d.book_info || d.bookInfo || d)
        if (info) {
          const name = info.book_name || info.bookName
          const author = info.author
          const words = info.word_number || info.wordNumber
          // ★ 顺手学字体映射：拿「PUA 原文」与「干净名」等长对齐，学到一条就少一次请求
          const puaT = (next.extra as any).titlePua || (hasPua(next.title) ? next.title : null)
          if (name && puaT) learned += learnPair(puaT, String(name), fontMap)
          const puaA = (next.extra as any).authorPua || (hasPua(next.author) ? next.author : null)
          if (author && puaA) learned += learnPair(puaA, String(author), fontMap)
          if (name) { next.title = String(name); next.extra.titleSuspect = false }
          if (author) next.author = String(author)
          if (words != null) next.extra.wordNumber = Number(words)
        }
        // 接口偶尔不吐书名 ⇒ 退一步抓书页 og:title / description（同 1s 限速内）
        if (next.extra.titleSuspect !== false) {
          // ★ 2026-10-17（1）：同上，节拍交给闸门
          const page = await boundedFetch('https://fanqienovel.com/page/' + encodeURIComponent(String(r.key)), {
            rateLimit: true, timeoutMs: 15000, signal: ctxBoard.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
          })
          requests += 1
          const html = await (page as any).text()
          const og = html.match(/<meta property="og:title" content="([^"]+)"/)
          const tg = html.match(/[<]title[>]([^<]+)/)
          const raw = (og && og[1]) || (tg && tg[1]) || ''
          const clean = String(raw).replace(/[_|\-]\s*番茄小说.*$/, '').trim()
          // 站点通用标题（缺书/404 页）不算书名，宁可留空也不写错
          const generic = !clean || /番茄小说|官网|好看的小说|^小说,/.test(clean)
          if (!generic) {
            next.title = clean
            next.extra.titleSuspect = false
            next.extra.titleFrom = 'book-page'
          } else {
            next.extra.titleSuspect = true
            next.extra.enrichError = true
          }
        }
      } catch (e) {
        next.extra.enrichError = true
      }
      out.push(next)
    }
    if (learned > 0) saveFontMap(root, fontMap)
    ;(globalThis as any).__rankLastLearn = learned
    // 回写缓存：书名/作者/字数（只写本次真拿到的）
    for (const r of out) {
      const bid = String(r.key || '')
      if (!bid) continue
      const t = r.extra && r.extra.titleSuspect === false ? String(r.title || '') : ''
      const a = r.author ? String(r.author) : ''
      const w = r.extra && typeof r.extra.wordNumber === 'number' ? r.extra.wordNumber : null
      if (!t && !a && w == null) continue
      pendingEntries.push({ site: 'fanqie', bookId: bid, entry: { collect: null, words: w, title: t || null, author: a || null, score: null } })
    }
    if (pendingEntries.length) putEntries(root, pendingEntries)
    return { rows: out, requests, learned, cacheHits } as any
  }

  /**
   * 书页命名解析（按站）：给书签的手动刷新与「手动添加」共用。
   * 起点/起点图复用 fetchBookStats（走书页缓存）；刺猬猫/菠萝包按站页特征解析；番茄走 api/book/info。
   * 1 请求/本，调用方负责 1s 间隔与预算。
   */
  async function fetchBookProfile(site: string, id: string, urlHint?: string): Promise<{ ok: boolean; title?: string | null; author?: string | null; words?: number | null; collect?: number | null; error?: string }> {
    const ua = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9' }
    try {
      if (site === 'qidian' || site === 'qidiantu') {
        const siteImpl: any = makeQidianMobileSite({ boardIds: ['sign-cat-all'] })
        if (typeof siteImpl.fetchBookStats !== 'function') return { ok: false, error: '起点适配器没有 fetchBookStats' }
        const ctxB: any = { now: () => clock.now(), signal: new AbortController().signal, requestTimeoutMs: 15000 }
        const stx = await siteImpl.fetchBookStats(String(id), ctxB)
        return { ok: true, words: stx.wordsCnt, collect: stx.collect }
      }
      if (site === 'fanqie') {
        const resp: any = await boundedFetch('https://fanqienovel.com/api/book/info?bookId=' + encodeURIComponent(String(id)), { headers: { 'User-Agent': ua['User-Agent'] }, rateLimit: true, timeoutMs: 15000 })
        const json: any = await resp.json().catch(() => null)
        const info = json && json.data && (json.data.book_info || json.data.bookInfo || json.data)
        if (!info) return { ok: false, error: '番茄接口没有返回书信息' }
        /**
         * 番茄 api/book/info 的真实字段（2026-10-15 实测）：bookName / authorName / wordNumber / readCount，
         * 且 wordNumber 是**字符串**（"281236"）⇒ 必须 Number() 转。兼容 snake_case 以防接口换形。
         */
        const name = info.book_name || info.bookName || null
        const author = info.author_name || info.authorName || info.author || null
        const rawWords = info.word_number != null ? info.word_number : info.wordNumber != null ? info.wordNumber : null
        const words = rawWords != null ? Number(rawWords) : null
        // 番茄的在读：优先 read_count（榜单接口口径、真实在读）；readCount 是**恒 "0" 的废弃字段**
        // ★ 2026-10-16：0 一律当成「取不到」—— 书签只在非 null 时覆盖，真 0 会把真实在读擦掉。
        const rawRead = info.read_count != null ? info.read_count : info.readCount != null ? info.readCount : null
        const read = rawRead != null ? Number(String(rawRead).replace(/[^0-9]/g, '')) : null
        return {
          ok: true, title: name, author,
          words: Number.isFinite(words as number) ? words : null,
          collect: read != null && Number.isFinite(read) && read > 0 ? read : null,
        }
      }
      const url = urlHint || (site === 'ciweimao' ? 'https://www.ciweimao.com/book/' + id : site === 'sfacg' ? 'https://book.sfacg.com/Novel/' + id + '/' : '')
      if (!url) return { ok: false, error: '这个站没有书页地址' }
      const resp: any = await boundedFetch(url, { headers: ua as any, rateLimit: true, timeoutMs: 15000 })
      const html = await resp.text()
      if (site === 'ciweimao') {
        const blk = html.match(/class="book-grade"[\s\S]{0,400}?<\/p>/)
        const seg = blk ? blk[0] : html
        const g = seg.match(/总点击：<b>([^<]*)<\/b>[\s\S]{0,40}?总收藏：<b>([^<]*)<\/b>[\s\S]{0,40}?总字数：<b>([^<]*)<\/b>/)
        const t = html.match(/<title>([^<]{1,80})/)
        const mk = (s?: string | null) => { if (s == null) return null; const x = String(s).split(',').join('').trim(); const m = x.match(/^([0-9.]+)万$/); if (m) return Math.round(Number(m[1]) * 10000); const n = Number(x.replace(/[^0-9.]/g, '')); return Number.isFinite(n) && x !== '' ? n : null }
        return { ok: true, title: t ? String(t[1]).replace(/最新章节.*$/, '').trim() : null, words: g ? mk(g[3]) : null, collect: g ? mk(g[2]) : null }
      }
      if (site === 'sfacg') {
        const t = html.match(/<title>([^<]{1,120})<\/title>/)
        const clean = t ? String(t[1]).split(' - ')[0].trim() : null
        const w = html.match(/字数[：:]\s*([\d,]+)\s*字/)
        const c = html.match(/>收藏\s*([\d,]+)\s*</) || html.match(/id="J_BookCollectCount"[^>]*>\s*([\d,]+)/)
        return { ok: true, title: clean, author: t ? authorFromBookTitle(String(t[1])) : null, words: w ? Number(String(w[1]).replace(/,/g, '')) : null, collect: c ? Number(String(c[1]).replace(/,/g, '')) : null }
      }
      return { ok: false, error: '这个站暂不支持按书号补全：' + site }
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 80) }
    }
  }

  /** 手动刷新（B 档，1 请求/本）：拿最新字数/收藏写进书签的作品快照；失败保留原值 */
  async function refreshBookmarkByBookPage(bm: any): Promise<boolean> {
    const parts = String(bm.bookKey).split(':')
    const id = parts.slice(1).join(':')
    const got = await fetchBookProfile(String(bm.site || 'qidian'), id, bm.url)
    if (!got.ok) return false
    const svc = BOOKMARKS
    if (!svc) return false
    /**
     * ★ 站方数据（收藏/在读）不再塞进"榜主指标"：书页取到的是**收藏**，
     *   而榜主指标是首订/名次，两者口径不同，混在一个字段里会互相覆盖。
     *   番茄书页的 readCount 同样是「在读」。
     */
    const label = bm.site === 'fanqie' ? '在读' : '收藏'
    svc.autoUpdate(bm.bookKey, {
      title: got.title || undefined,
      author: got.author || undefined,
      words: typeof got.words === 'number' ? got.words : undefined,
      collect: got.collect != null ? got.collect : undefined,
      collectLabel: label,
      collectFrom: got.collect != null ? 'book-page' : undefined,
      valueFrom: 'book-page',
      capturedAt: new Date().toISOString(),
    })
    return true
  }
  const server: any = ctx.webServer || null
  const bindRoute = (s: any) => {
    if (!s || typeof s.register !== 'function') {
      routeBound = false
      ctx.logger?.info?.('[' + name + '] webServer 不可用：/api/rank-scan/* 路由未注册（半激活：面板仍可用，诊断栏会标出来）')
      return
    }
    routeBound = true
    const route = () => s.register({
      kind: 'prefix',
      // 注意：宿主 match() 的规则是 pathname === prefix || pathname.startsWith(prefix + '/')
      // ⇒ 带尾斜杠的 '/api/rank-scan/' 永远匹配不到 '/api/rank-scan/overview'（会被更短的 '/api' 抢走）
      path: '/api/rank-scan',
      handler: async (req: any, res: any) => {
        const send = (code: number, body: any) => {
          res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify(body))
        }
        try {
          const u = new URL(String(req.url || '/'), 'http://localhost')
          const q = u.searchParams
          // 归一化尾斜杠：'/api/rank-scan//overview' 与 '/api/rank-scan/overview' 等价
          const p = u.pathname.replace(/\/+$/, '')
          // ★ 2026-10-16（票 23）：来源闸。宿主对 /api/rank-scan/* 不做鉴权，而浏览器跨站页面
          //   能用「简单请求」（text/plain 的 POST）绕开预检打进来 ⇒ 带 Origin/Referer 且非同源的
          //   一律 403；不带头的本地脚本/进程照旧（闸门不是为了防它们）。
          {
            const gate = requestAllowed(req.headers)
            if (!gate.ok) return send(403, { error: '拒绝跨来源请求（' + gate.reason + '）' })
          }
          if (p === '/api/rank-scan/catalog') return send(200, catalog())
          // 自检路由：面板/运维用来确认宿主路由已经挂上（不是业务数据）
          if (p === '/api/rank-scan/health') return send(200, { ok: true, port: s.port ?? null, root, dataDates: listDataDates(root) })
          /**
           * ★ 2026-10-16：版本与更新（面板「版本」区）。
           *   - version：本插件自己的版本（读包根 package.json；__dirname 在 lib/ ⇒ 由 readOwnVersion 回上一层）；
           *   - update-check：探测 dsh-market；装了就用它查（可一键更新），没装就退化成 npm registry 只读读数；
           *   - update / update-operation：**只转发**，绝不自己 spawn 包管理器或重启宿主。
           */
          if (p === '/api/rank-scan/version') {
            const own = readOwnVersion(import.meta.url)
            return send(200, { ok: true, name: own.name, version: own.version, marketEndpoint: '/dsh-market/api/v1/capabilities' })
          }
          if (p === '/api/rank-scan/update-check') {
            const own = readOwnVersion(import.meta.url)
            const cookie = (req.headers && (req.headers.cookie || req.headers.Cookie)) || null
            const host = (req.headers && req.headers.host) || ('127.0.0.1:' + (s.port || 19387))
            // 两个探测互不阻塞；任一失败都只是「查不到」，不影响另一个
            const [market, npm] = await Promise.all([
              probeMarket(fetch as any, { origin: 'http://' + host, cookie: cookie ? String(cookie) : null }),
              fetchNpmLatest(fetch as any, own.name || 'dsh-rank-scan'),
            ])
            let marketLatest: string | null = null
            if (market && own.name && market.endpoints && market.endpoints.updates) {
              try {
                const r = await fetch('http://' + host + market.endpoints.updates + '?name=' + encodeURIComponent(own.name), {
                  headers: { Accept: 'application/json', ...(cookie ? { Cookie: String(cookie) } : {}) },
                  signal: AbortSignal.timeout(4000),
                }) as any
                if (r && r.ok !== false) {
                  const j: any = await r.json()
                  marketLatest = j && (j.latestVersion || j.targetVersion) ? String(j.latestVersion || j.targetVersion) : null
                }
              } catch { marketLatest = null }
            }
            const opId = q.get('operationId')
            let operation: any = null
            if (opId && market && market.endpoints && market.endpoints.updateOperation) {
              try {
                const r = await fetch('http://' + host + market.endpoints.updateOperation + '?operationId=' + encodeURIComponent(opId), {
                  headers: { Accept: 'application/json', ...(cookie ? { Cookie: String(cookie) } : {}) },
                  signal: AbortSignal.timeout(4000),
                }) as any
                if (r && r.ok !== false) operation = normalizeOperation(await r.json())
              } catch { operation = null }
            }
            const view = buildUpdateView({
              // ★ 读不到版本时用空串（compareVersions 判相等 ⇒ 显示「已最新」），
              //   绝不用 '0.0.0'：那会让面板恒判「有新版」，诱导用户点一个没意义的更新。
              current: own.version || '',
              name: own.name,
              market,
              marketLatest,
              npmLatest: npm.version,
              npmReason: npm.reason,
              operation,
            })
            return send(200, { ok: true, ...view })
          }
          /**
           * ★ 重启**只**转发市场自己的重启端点（规范：客户端不许发明替代的进程控制路径）。
           *   桌面版/被监管宿主的 capabilities.restart.supported = false ⇒ 这里会明确拒绝，
           *   面板也不会显示重启按钮（改成提示用户自己重启）。
           */
          if (p === '/api/rank-scan/update-restart') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const cookie = (req.headers && (req.headers.cookie || req.headers.Cookie)) || null
            const host = (req.headers && req.headers.host) || ('127.0.0.1:' + (s.port || 19387))
            const market = await probeMarket(fetch as any, { origin: 'http://' + host, cookie: cookie ? String(cookie) : null })
            if (!market || market.restartSupported !== true || !market.endpoints || !market.endpoints.restart) {
              return send(501, { error: '宿主不支持由插件触发重启（桌面版/被监管宿主）：请你自己重启 DSH' })
            }
            try {
              const r = await fetch('http://' + host + market.endpoints.restart, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(cookie ? { Cookie: String(cookie) } : {}) },
                body: '{}',
                signal: AbortSignal.timeout(8000),
              }) as any
              const j: any = r && r.json ? await r.json().catch(() => null) : null
              if (!r || r.ok === false) return send(502, { error: '重启请求被拒绝' + (r && r.status ? '（HTTP ' + r.status + '）' : ''), detail: j })
              return send(200, { ok: true, detail: j })
            } catch (e) {
              return send(502, { error: '调用重启端点失败：' + String(e).slice(0, 120) })
            }
          }
          if (p === '/api/rank-scan/update') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const own = readOwnVersion(import.meta.url)
            const cookie = (req.headers && (req.headers.cookie || req.headers.Cookie)) || null
            const host = (req.headers && req.headers.host) || ('127.0.0.1:' + (s.port || 19387))
            const market = await probeMarket(fetch as any, { origin: 'http://' + host, cookie: cookie ? String(cookie) : null })
            if (!market || !market.endpoints || !market.endpoints.updates) {
              return send(501, { error: '没有可用的更新提供方（未安装 dsh-market，或它不支持就地更新）' })
            }
            try {
              const r = await fetch('http://' + host + market.endpoints.updates, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(cookie ? { Cookie: String(cookie) } : {}) },
                body: JSON.stringify({ packageName: own.name }),
                signal: AbortSignal.timeout(8000),
              }) as any
              const j: any = r && r.json ? await r.json().catch(() => null) : null
              if (!r || r.ok === false) {
                return send(502, { error: '更新提供方拒绝了请求' + (r && r.status ? '（HTTP ' + r.status + '）' : ''), detail: j })
              }
              return send(202, { ok: true, operationId: j && (j.operationId || j.id) ? String(j.operationId || j.id) : null, detail: j })
            } catch (e) {
              return send(502, { error: '调用更新提供方失败：' + String(e).slice(0, 120) })
            }
          }
          /**
           * ★ 2026-10-17（补全移出阻塞路径）：后台补全进度（GET，面板每 5 秒轮询一次）。
           * 只回两个小字段，别把整个 catalog 拖进轮询。
           */
          if (p === '/api/rank-scan/enrich-status') {
            const stE: any = readState()
            return send(200, {
              ok: true,
              // ★ 审查（非阻塞 5）：active 一律现算 —— 进程在工人运行时退出的话，落盘里的 active 会永远是 true，
              //   面板会一直显示「补全中 0/N」但根本没人在跑。
              enrichRun: stE.enrichRun ? { ...stE.enrichRun, active: timerState.enrichWorker } : null,
              pending: Object.keys((stE.enrichPending) || {}).length,
              // ★ 2026-10-17（发布前修）：横幅要区分「还能续跑」与「当日已试满」；间隔用于把文案写成真实节拍
              retryable: retryablePendingCount(),
              requestIntervalMs: minRequestIntervalMs(),
              worker: timerState.enrichWorker,
              cache: bookCacheStats(root),
              ttlDays: Math.round(BOOK_CACHE_TTL_MS / 86400000),
            })
          }
          if (p === '/api/rank-scan/overview') return send(200, await panelOverview())
          if (p === '/api/rank-scan/board') {
            const b = q.get('boardId')
            if (!b) return send(400, { error: 'boardId 必填' })
            return send(200, await panelBoard(b, q.get('date') || undefined, q.get('sort') || undefined, Number(q.get('limit') || 0)))
          }
          if (p === '/api/rank-scan/changes') return send(200, await panelChanges(q.get('date') || undefined))
          if (p === '/api/rank-scan/select') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const body = await readBody(req)
            const st3 = readState()
            if (Array.isArray(body.captures)) {
              const posted = body.captures.map(String)
              // 面板只能管清单内的榜；清单外的既有抓取项原样保留（防止「保存丢榜」）
              const known = new Set(catalog().boards.map((b: any) => b.boardId))
              const keep = (st3.boards as string[]).filter((b) => !known.has(b))
              st3.boards = Array.from(new Set(keep.concat(posted)))
              // 口径：抓了就要显示 ⇒ 显示集跟随抓取集（派生榜随番茄开关自动进出）
              st3.display = (st3.boards as string[]).filter((b) => !b.startsWith('fanqie.derived.'))
            }
            if (Array.isArray(body.displays)) st3.display = body.displays.map(String)
            if (typeof body.autoEnrich === 'boolean') st3.autoEnrich = body.autoEnrich
            if (typeof body.qidianEnrich === 'boolean') st3.qidianEnrich = body.qidianEnrich
        /**
         * ★ 2026-10-17（3）：全局请求间隔（真实请求之间）。0 = 关闭限速（只建议本地测试）；
         * 其余下限 200ms，避免手滑写成 1ms 变成连发。
         */
        if (body.requestIntervalMs !== undefined) {
          const n = Number(body.requestIntervalMs)
          if (!Number.isFinite(n) || n < 0) return send(400, { error: '请求间隔应为 >=0 的毫秒数' })
          if (n > 0 && n < 200) return send(400, { error: '请求间隔最小 200ms（更小的值等于放弃限速）' })
          st3.requestIntervalMs = n
          applyRequestInterval(n)
        }
            writeState(st3)
            return send(200, { ok: true, captures: st3.boards.length, displays: st3.display.length, note: '已保存 ' + st3.boards.length + ' 个榜（下次扫描生效）' })
          }
          if (p === '/api/rank-scan/timer') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const body = await readBody(req)
            const stT: any = readState()
            if (typeof body.enabled === 'boolean') stT.timerEnabled = body.enabled
            if (typeof body.scanTime === 'string') {
              if (!validTime(body.scanTime)) return send(400, { error: '时间格式应为 HH:mm（00:00–23:59）' })
              stT.scanTime = body.scanTime
            }
            // ★ 按站分时（2026-10-16）：siteTimes 只接受已知站 + HH:mm；fallbackTime 同理
            if (body.siteTimes && typeof body.siteTimes === 'object') {
              const next: Record<string, string> = { ...(stT.siteTimes || DEFAULT_SITE_TIMES) }
              for (const [site, t] of Object.entries(body.siteTimes as Record<string, unknown>)) {
                if (SITE_ORDER.indexOf(site) < 0) return send(400, { error: '未知站点：' + site })
                const v = String(t || '')
                if (!validTime(v)) return send(400, { error: '站点 ' + site + ' 的时间格式应为 HH:mm' })
                next[site] = v
              }
              stT.siteTimes = next
            }
            if (typeof body.fallbackTime === 'string') {
              if (!validTime(body.fallbackTime)) return send(400, { error: '兜底时间格式应为 HH:mm' })
              stT.fallbackTime = body.fallbackTime
            }
            stT.timerSchemaV = 6
            writeState(stT)
            const on = stT.timerEnabled === true
            // ★ 票 25：开关变化立刻接/断，不用等重启
            const armed = syncTimer()
            return send(200, {
              ok: true, enabled: on, scanTime: stT.scanTime, siteTimes: stT.siteTimes, fallbackTime: stT.fallbackTime,
              siteLastRun: stT.siteLastRun || {}, siteLastTimerAt: (stT as any).siteLastTimerAt || {}, plan: timerPlanNow(), armed,
              note: (on
                ? '定时已开启（按站分时）：' + SITE_ORDER.map((s) => (SITE_CN[s] || s) + ' ' + ((stT.siteTimes || {})[s] || '—')).join('、') + '；当天没跑成的站到 ' + (stT.fallbackTime || DEFAULT_FALLBACK_TIME) + ' 补跑'
                : '定时扫描已关闭（面板「立刻扫一次」仍可用）') + (on
                ? (armed ? '；定时器已接线' : '；注意：宿主 timer 服务不可用，暂未接线')
                : '；定时器已断开'),
            })
          }
          if (p === '/api/rank-scan/timer-plan') {
            // 只读：现在这一刻会跑哪个站 / 为什么没跑（零请求，诊断与集成测试用）
            return send(200, { ok: true, plan: timerPlanNow(), siteLastRun: (readState() as any).siteLastRun || {}, siteLastTimerAt: (readState() as any).siteLastTimerAt || {} })
          }
          if (p === '/api/rank-scan/depth') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const body = await readBody(req)
            const boardId = String(body.boardId || '')
            const n = Math.max(1, Math.min(100, Number(body.depth) || 10))
            if (!boardId) return send(400, { error: 'boardId 必填' })
            const st2 = readState()
            st2.depths = { ...(st2.depths || {}), [boardId]: n }
            writeState(st2)
            return send(200, { ok: true, boardId, depth: n, note: '每榜取数已设为 ' + n + ' 条（下次扫描生效）' })
          }
          /**
           * ★ 2026-10-17（数据正确性 P0）：按日期直查的**落盘闸门**。
           * 背景：番茄/起点图的榜单页只给「当下」榜面 —— 对历史地址照样返回今天的榜。
           * 把这种内容写成「那天的快照」不是补数据，是不可回滚的污染：日期一旦被占，
           * 事后再也分不清哪几天的数据是假的（站点上取不回真值对照）。
           * 规则：
           *   ① 写「今天」= 与日常扫描同一语义（当下的榜面本来就属于今天）⇒ 放行；
           *   ② 写历史日期必须可核对：适配器用 contentDateFor 声明「数据日期 → 应当看到的内容日期」，
           *      且实际返回的 contentDate（页面自报日期）必须与之相等；
           *   ③ 站没声明 / 页面没给日期 / 日期对不上 ⇒ 409 拒绝，一个字节都不写。
           */
          const dayWriteVerdict = (site: any, boardId: string, date: string, res: any): { ok: boolean; code?: string; error?: string; contentDate: string | null; expected: string | null } => {
            const contentDate = (res && (res.contentDate || res.date)) || null
            const expected = typeof site.contentDateFor === 'function' ? site.contentDateFor(boardId, date) : null
            if (date === localDate(clock.now())) return { ok: true, contentDate: contentDate, expected: expected }
            if (expected == null) {
              return {
                ok: false, code: 'unsupported', contentDate: contentDate, expected: expected,
                error: '该站不提供可核对的历史榜面（站点对历史地址仍返回当下榜面）⇒ 拒绝把这次抓到的内容写成 ' + date + ' 的快照。历史只能来自当天真实跑过的那次抓取。',
              }
            }
            if (contentDate == null) {
              return {
                ok: false, code: 'unverifiable', contentDate: contentDate, expected: expected,
                error: '站点没给出内容日期，无法确认这份数据属于 ' + date + '（期望内容日期 ' + expected + '）⇒ 拒绝落盘。',
              }
            }
            if (contentDate !== expected) {
              return {
                ok: false, code: 'mismatch', contentDate: contentDate, expected: expected,
                error: '内容日期不一致：站点给的是 ' + contentDate + '，期望 ' + expected + '（数据日期 ' + date + '）⇒ 拒绝落盘（否则就是把当下的榜面记到过去日期名下）。',
              }
            }
            return { ok: true, contentDate: contentDate, expected: expected }
          }
          if (p === '/api/rank-scan/day') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const body = await readBody(req)
            const boardId = String(body.boardId || '')
            // ★ 2026-10-16（审计 P0-2）：date 会直入 store.writeSnapshot 的路径拼接
            //   （store.ts 的 join(this.root, dataDate, …)）⇒ 与 /repair 共用同一道校验，
            //   否则 date='../../x' 能把快照写到数据根之外。
            let date: string
            try { date = assertDataDate(body.date) } catch (e) { return send(400, { error: e instanceof Error ? e.message : String(e) }) }
            if (!boardId) return send(400, { error: 'boardId 必填' })
            const stDay = readState()
            const site: any = serveSiteFor([boardId], stDay.depths || {})[0]
            if (!site) return send(400, { error: '没有这个站的适配器：' + boardId })
            const target = new Date(date + 'T12:00:00+08:00')
            const res = await site.fetchBoard(boardId, { now: () => target, signal: new AbortController().signal, requestTimeoutMs: 15000 })
            // ★ 先判定、后落盘：内容日期对不上时下面这个 writeSnapshot 一步都不该走到
            const verdict = dayWriteVerdict(site, boardId, date, res)
            if (!verdict.ok) {
              return send(409, {
                ok: false, code: verdict.code, error: verdict.error,
                boardId, date, contentDate: verdict.contentDate, expected: verdict.expected, saved: false,
              })
            }
            if (body.save) {
              const store3 = new FileStore(root)
              await store3.writeSnapshot({ boardId, dataDate: date, metric: (res as any).metric || 'value', rows: res.rows })
              // ★ 工作包 A：手工补数成功 ⇒ 解除隔离标记并同步当天逐榜状态
              await trustBoardDay(date, boardId, new Date().toISOString())
            }
            return send(200, {
              ok: true, boardId, date, saved: !!body.save, contentDate: verdict.contentDate, expected: verdict.expected,
              defaultSortKey: defaultSortKeyFor(boardId),
              rowsAll: res.rows,
              count: res.rows.length,
              note: (body.save ? '已抓取并存入本地快照' : '直查站点该日期（未落盘）') + (verdict.contentDate ? '；内容日期 ' + verdict.contentDate : ''),
            })
          }
          if (p === '/api/rank-scan/repair') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const body = await readBody(req)
            const mode = String(body.mode || 'rescan')
            // ★ 2026-10-16（审计 P0-2）：date 直接来自 POST body，而本路由**未鉴权**（实测 text/plain
            //   简单请求也照样执行）⇒ 先卡格式、再卡根目录包含。否则 {"mode":"drop","date":".."}
            //   会递归删掉 ~/.dsh/data（其它插件的数据目录也在里面）。
            let date: string
            try { date = assertDataDate(body.date) } catch (e) { return send(400, { error: e instanceof Error ? e.message : String(e) }) }
            if (mode === 'drop') {
              const dir = resolve(root, date)
              if (relative(resolve(root), dir).startsWith('..')) return send(400, { error: '日期越界，拒绝删除' })
              if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
              return send(200, { ok: true, dropped: date, gone: !existsSync(dir) })
            }
            const b = String(body.boardId || 'qidiantu.shouding')
            const st4 = readState()
            const site: any = serveSiteFor([b], st4.depths || {})[0]
            if (!site) return send(400, { error: '没有这个站的适配器：' + b })
            // 关键：clock 用**目标日期**，否则单日榜会取到今天的内容写到昨天名下
            const target = new Date(date + 'T01:30:00+08:00')
            const res = await site.fetchBoard(b, { now: () => target, signal: new AbortController().signal, requestTimeoutMs: 15000 })
            // ★ 与 /day 同一道闸门：旧实现的 contentDate 判定形同虚设——没有任何适配器会返回它
            const verdictR = dayWriteVerdict(site, b, date, res)
            if (!verdictR.ok) {
              return send(409, { ok: false, code: verdictR.code, error: verdictR.error, boardId: b, date, contentDate: verdictR.contentDate, expected: verdictR.expected })
            }
            const contentDate = verdictR.contentDate
            const store2 = new FileStore(root)
            await store2.writeSnapshot({ boardId: b, dataDate: date, metric: res.metric || 'value', rows: res.rows })
            // ★ 工作包 A：修数成功 ⇒ 解除隔离、同步逐榜状态
            await trustBoardDay(date, b, new Date().toISOString())
            // 同步当天 scan.json 的记录，保持「快照 = 记录」
            const rec2: any = await store2.readScan(date)
            if (rec2) {
              const row2 = (rec2.boards || []).find((x: any) => x.boardId === b)
              if (row2) { row2.rows = res.rows; await store2.writeScan(rec2) }
            }
            return send(200, { ok: true, date, boardId: b, contentDate, nulls: res.rows.filter((r: any) => r.value === null).length, total: res.rows.length })
          }
          if (p === '/api/rank-scan/retention') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const body = await readBody(req)
            // ★ 2026-10-16（使用者提的缺口）：保留策略以前只能手改 config.json，现在面板可选
            const v = normalizeRetention(body.days)
            if (v === null) return send(400, { error: '保留天数必须是 7–3650 的整数，或 "forever"（永久）' })
            const stR = readState()
            ;(stR as any).retentionDays = v
            writeState(stR)
            const res = runRetention(root, localDate(clock.now()), v)
            storageSummary(true)
            ctx.logger?.info?.('[' + name + '] 保留策略 = ' + v + '，本次删除 ' + res.removed.length + ' 个数据日期目录')
            return send(200, {
              ok: true, retentionDays: v, deleted: res.removed, freedBytes: res.freed,
              note: v === 'forever'
                ? '已设为永久保留（不再自动删除数据日期目录；state/ 本来就不动）'
                : '已保留最近 ' + v + ' 天；本次删除 ' + (res.removed.length ? res.removed.join('、') : '0 个目录（没有过期数据）'),
            })
          }
          if (p === '/api/rank-scan/enrich-all') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            return send(200, await enrichAll(q.get('site') || 'fanqie'))
          }
          if (p === '/api/rank-scan/enrich') {
            const forceQ = q.get('force') === '1' || q.get('force') === 'true'
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const b = q.get('boardId')
            if (!b) return send(400, { error: 'boardId 必填' })
            const resE: any = await enrichBoard(b, forceQ)
            /**
             * ★ 2026-10-17：手动「补全本榜」补齐后要**把待办销掉** —— 以前只有后台工人那一圈会清，
             *   手动路径补完了待办还挂着 ⇒ 横幅永远显示「补全已尽力 N 个榜」，而数据其实已经齐了。
             */
            try {
              if (resE && resE.ok) {
                const snapE: any = new FileStore(root).readSnapshot(latestDataDate(), b)
                if (!needsEnrichRows(b, (snapE && snapE.rows) || [])) {
                  clearEnrichPending(b)
                  /**
                   * ★ 2026-10-17：销账之后把「补全进度」也归位 —— 否则 enrichRun 还记着上一轮的
                   *   { done:0, total:1 }，面板横幅会拿它算出「还剩 1 个榜」，明明已经补齐了。
                   */
                  try {
                    const s9 = readState()
                    const left9 = Object.keys(((s9 as any).enrichPending) || {}).length
                    if (!left9 && (s9 as any).enrichRun) {
                      ;(s9 as any).enrichRun = { ...(s9 as any).enrichRun, done: (s9 as any).enrichRun.total || 0, active: false, note: '已补齐（手动补全）' }
                      writeState(s9)
                    }
                  } catch { /* 归位失败不影响本次结果 */ }
                }
              }
            } catch { /* 销账失败不影响本次结果 */ }
            return send(200, resE)
          }
          if (p === '/api/rank-scan/qidianEnrich') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const forceQ = q.get('force') === '1' || q.get('force') === 'true'
            const bid = q.get('boardId')
            if (bid) return send(200, await qidianEnrichBoard(bid, forceQ))
            // 不带 boardId = 把抓取集里的起点榜逐个补（仍受每榜请求上限保护）
            const stQ = readState()
                    // ★ 2026-10-17（发布前修）：三江的字数走同一条起点书页通道 ⇒ 批量补全也必须带上它，
              //   否则面板「起点补全」按钮永远漏掉三江（与「一个开关管起点收藏 + 三江字数」的口径不符）。
              const list = (stQ.boards as string[]).filter((b) => b.startsWith('qidian.') || b.startsWith('qidiantu.'))
            const results: any[] = []
            const tQ = Date.now()
            const skippedQ: string[] = []
            for (const b of list) {
              if (Date.now() - tQ > BATCH_ENRICH_CAP_MS) { skippedQ.push(b); continue }
              results.push(await qidianEnrichBoard(b, forceQ))
            }
            return send(200, { ok: true, boards: results, skipped: skippedQ, stoppedByTime: skippedQ.length > 0, note: (skippedQ.length ? '已到 ' + Math.round(BATCH_ENRICH_CAP_MS / 60000) + ' 分钟上限，跳过 ' + skippedQ.length + ' 个榜；' : '') + '起点书页补全：' + results.map((x) => x.boardId + ' 命中' + (x.cacheHit || 0) + '/新打' + (x.fetched || 0)).join('；') })
          }
          if (p === '/api/rank-scan/qidianCache') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const body = await readBody(req)
            if (body.clear === true) {
              const gone = clearCache(root)
              return send(200, { ok: true, cleared: gone, note: gone ? '起点书页缓存已清空（下次补全会重新打书页）' : '缓存本来就是空的' })
            }
            return send(200, { ok: true, cache: cacheStats(root), ttlDays: Math.round(QIDIAN_CACHE_TTL_MS / 86400000) })
          }
          if (p === '/api/rank-scan/cancel') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            await new FileStore(root).setCancelFlag(true)
            return send(200, { ok: true, note: '已请求停止：当前扫描会在下一个请求间隙停下' })
          }
          if (p === '/api/rank-scan/retry') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            // ★ 2026-10-16（使用者反馈「刺猬猫抓取没有自动补字数和收藏」）：
            //   补全原来只挂在 doScan 的 opts.enrichAfter 上，而这条路没传 ⇒ **重试出来的榜永不补全**
            //   （实测：重试拿到 10 行，书页请求 0 次，快照 collect/wordsCnt 全空）。
            //   传 partial 让 postScanEnrich 只补本次重试覆盖到的榜（autoEnrich 由它自己再判一次）。
            const got = await withScanLock(() => doScan('manual', { retry: true, enrichAfter: true, partial: true }))
            if (!got.ok) return send(409, { error: '已有扫描在进行中，请等它跑完' })
            const rec2: any = got.value
            return send(200, { ok: true, outcome: rec2.outcome, dataDate: rec2.dataDate, attempt: rec2.attempt, progress: rec2.progress, revision: dataRevision(rec2.dataDate) })
          }
          if (p === '/api/rank-scan/scan') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            // 扫描互斥（★ 票 30：现在手动侧也真的**置位**，第二发拿到 409 而不是撞文件锁报 500）
            if (timerState.scanInFlight) return send(409, { error: '已有扫描在进行中（定时或另一个手动扫描），请等它跑完' })
            const body = await readBody(req)
            const bsel = typeof body.boards === 'string' ? String(body.boards).trim() : Array.isArray(body.boards) ? body.boards.join(',') : ''
            // 指定榜 = 只扫这个榜（**不跑全站补全**）
            // 全站扫（不指定榜）也**默认不补全**：补全是 89~100 请求的长任务，只由定时任务或手动点「补齐」按钮触发。
            // （2026-10-15 事故后收紧：此前面板「立刻扫一次」会跟着 autoEnrich 一起跑补全）
            /**
             * ★ 2026-10-16（既定口径变更）：**手动「立刻扫一次」也带补全**。
             * 旧口径（10-15）是「手动不补省请求」；现在补全已在 postScanEnrich(only) 里**限定本次扫描范围**，
             * 不会顺带抓别站，所以手动扫就按同一套补全跑。要省请求可显式传 enrichAfter:false。
             */
            /**
             * ★ 2026-10-17（口径变更）：**补全从 /scan 的等待里摘出去**。
             * 旧口径（10-16）手动扫要等 ~6 分钟（抓榜只占 71 秒，其余全是补全）。
             * 现在默认 deferEnrich=true：抓完榜立刻落盘返回，补全交给后台工人，面板显示「补全中 N/M」。
             * 想要旧的同步行为传 deferEnrich:false；要完全关掉补全传 enrichAfter:false。
             */
            const opts: any = { enrichAfter: body.enrichAfter !== false, deferEnrich: body.deferEnrich !== false }
            if (bsel) opts.boards = bsel
            if (body.enrich === true) opts.enrich = true
            const got = await withScanLock(() => doScan('manual', opts))
            if (!got.ok) return send(409, { error: '已有扫描在进行中（定时或另一个手动扫描），请等它跑完' })
            const rec: any = got.value
            const stR: any = readState()
            const dayAfter: any = new FileStore(root).readDayIndex(rec.dataDate)
            return send(200, {
              ok: true, outcome: rec.outcome, dataDate: rec.dataDate, attempt: rec.attempt, progress: rec.progress,
              scannedAll: !bsel,
              /** ★ 工作包 A：同日 revision（前端据此重新取 overview/board/changes） */
              revision: dataRevision(rec.dataDate),
              /** 当天**逐榜**最终状态（不是本批）——A 站失败不会被 B 站成功冲掉 */
              day: dayAfter
                ? Object.keys(dayAfter.boards).map((k: string) => ({
                    boardId: k,
                    status: dayAfter.boards[k].status,
                    reason: dayAfter.boards[k].reason,
                    trusted: dayAfter.boards[k].trusted !== false,
                    samePeriod: dayAfter.boards[k].samePeriod === true,
                  }))
                : null,
              enrich: stR.enrichRun ? { ...stR.enrichRun, active: timerState.enrichWorker } : null,
              enrichPending: Object.keys((stR.enrichPending) || {}).length,
              boards: (rec.boards || []).map((b: any) => ({ boardId: b.boardId, status: b.status, rows: (b.rows || []).length })),
            })
          }
          // ── 书签（用户数据；独立于快照与保留策略） ──────────────────────
          if (p === '/api/rank-scan/bookmarks') {
            const svc = BOOKMARKS!
            let list = svc.all()
            const siteQ = q.get('site')
            const folderQ = q.get('folder')
            const tagQ = q.get('tag')
            const textQ = (q.get('q') || '').trim().toLowerCase()
            if (siteQ) list = list.filter((b) => b.site === siteQ)
            if (folderQ) list = list.filter((b) => b.folders.includes(folderQ))
            if (tagQ) list = list.filter((b) => b.tags.includes(tagQ))
            if (textQ) list = list.filter((b) => (b.label + ' ' + (b.author || '') + ' ' + b.note).toLowerCase().includes(textQ))
            return send(200, { ok: true, total: list.length, bookmarks: list, folders: svc.folders(), health: svc.health() })
          }
          if (p === '/api/rank-scan/bookmarks/trash') {
            const svc = BOOKMARKS!
            return send(200, { ok: true, trash: svc.trash() })
          }
          if (p === '/api/rank-scan/bookmark/sync') {
            const svc = BOOKMARKS!
            const s = svc.sync()
            return send(200, { ok: true, total: s.total, map: s.map, health: svc.health() })
          }
          if (p === '/api/rank-scan/bookmark') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const svc = BOOKMARKS!
            const body = await readBody(req)
            const action = String(body.action || '')
            const bookKey = String(body.bookKey || '')
            if (action === 'add') {
              let row = body.row || null
              let boardId = String(body.boardId || '')
              let dataDate = String(body.dataDate || '')
              /**
               * ★ 只给了 bookKey 的情况（「变化集」就是这么调用的）：去本地快照里把这本书找出来，
               * 用它**真实的** row（书名/作者/字数/指标/名次）建签 —— 客户端不必认识快照结构。
               * 变化集本身不含书号，所以客户端用 key 前缀 boardId 传 bookKey（见 lib/client.js）。
               */
              if (!row) {
                // 变化集给的是「榜 + 书名」（它不含书号）⇒ 也用书名在这一榜的快照里定位
                const id = String(bookKey).split(':').slice(1).join(':')
                const titleWanted = String(body.title || '')
                const stBm = readState()
                const datesBm = listDataDates(root)
                const storeBm = new FileStore(root)
                let found: any = null
                for (let i = datesBm.length - 1; i >= 0 && !found; i--) {
                  const boards = boardId ? [boardId] : (stBm.boards as string[])
                  for (const b of boards) {
                    const snap: any = storeBm.readSnapshot(datesBm[i], b)
                    if (!snap || !Array.isArray(snap.rows)) continue
                    const hit = snap.rows.find((r: any) => (id && String(r.key) === id) || (titleWanted && String(r.title || '').trim() === titleWanted))
                    if (hit) { found = { row: hit, boardId: b, dataDate: datesBm[i] }; break }
                  }
                }
                if (!found) return send(404, { ok: false, error: '本地快照里找不到这本书：' + bookKey })
                row = found.row
                boardId = found.boardId
                dataDate = found.dataDate
              }
              const ex = row.extra || {}
              const meta: any = boardMeta(String(body.boardId || ''))
              const r = svc.add({
                bookKey,
                site: (row.site || meta.site || 'qidian') as SiteId,
                url: String(row.url || ''),
                source: body.source === 'manual' ? 'manual' : 'board',
                input: body.input == null ? null : String(body.input),
                title: row.title == null ? null : String(row.title),
                author: row.author == null ? null : String(row.author),
                words: typeof ex.wordsCnt === 'number' ? ex.wordsCnt : typeof ex.wordNumber === 'number' ? ex.wordNumber : typeof ex.words === 'number' ? ex.words : null,
                metric: typeof row.value === 'number' ? { name: mainLabelOf(boardId, meta), value: row.value } : null,
                // 站方数据（收藏/在读）：卡片上单独一行显示，与榜的「主指标」（首订/名次）区分开
                ...((): any => { const c = collectOf(String((meta && meta.site) || row.site || ''), row); return { collect: c.value, collectLabel: c.label, collectFrom: c.from } })(),
                metricBoard: boardId || null,
                metricDate: dataDate || null,
                capturedAt: dataDate ? new Date(dataDate + 'T12:00:00+08:00').toISOString() : undefined,
                valueFrom: 'snapshot',
                firstSeen: boardId ? { boardId, rank: typeof row.rank === 'number' ? row.rank : null, dataDate } : null,
              }, { note: body.note, folders: Array.isArray(body.folders) ? body.folders : undefined, seen: boardId ? { boardId, rank: typeof row.rank === 'number' ? row.rank : null, dataDate } : undefined })
              return send(200, { ok: true, created: r.created, total: svc.sync().total, bookmark: r.bookmark })
            }
            if (action === 'update') {
              const r = svc.setUserContent(bookKey, { note: body.note, folders: Array.isArray(body.folders) ? body.folders : undefined })
              if (!r) return send(404, { ok: false, error: '没有这条书签：' + bookKey })
              return send(200, { ok: true, bookmark: r })
            }
            if (action === 'remove') {
              if (!svc.remove(bookKey)) return send(404, { ok: false, error: '没有这条书签：' + bookKey })
              return send(200, { ok: true, removed: bookKey, total: svc.sync().total })
            }
            if (action === 'restore') {
              const r = svc.restore(bookKey)
              if (!r.restored) return send(404, { ok: false, error: '回收站里没有这条：' + bookKey })
              return send(200, { ok: true, merged: r.merged, total: svc.sync().total })
            }
            if (action === 'purge') {
              const gone = svc.purge (Array.isArray(body.bookKeys) ? body.bookKeys.map(String) : undefined)
              return send(200, { ok: true, purged: gone })
            }
            return send(400, { error: 'action 必须是 add/update/remove/restore/purge' })
          }
          if (p === '/api/rank-scan/bookmark/add-manual') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const body = await readBody(req)
            const ref = parseBookInput(body.input, body.site)
            if (!ref) return send(400, { ok: false, error: '认不出这条输入。支持：书页 URL、qidian:<书号> 这类前缀、或纯书号（此时须选站）' })
            const svc = BOOKMARKS!
            const has = svc.all().find((b) => b.bookKey === ref.bookKey)
            if (has) return send(200, { ok: true, created: false, existed: true, bookKey: ref.bookKey, note: '这条已经在书签里了（未重复添加）' })
            const got = await fetchBookProfile(ref.site, ref.key, ref.url)
            const note = String(body.note || '')
            const r = svc.add({
              bookKey: ref.bookKey, site: ref.site, url: ref.url, source: 'manual', input: String(body.input || ''),
              title: got.ok ? (got.title || null) : null, author: got.ok ? (got.author || null) : null,
              words: got.ok && typeof got.words === 'number' ? got.words : null,
              collect: got.ok && got.collect != null ? got.collect : null,
              collectLabel: ref.site === 'fanqie' ? '在读' : '收藏',
              collectFrom: got.ok && got.collect != null ? 'book-page' : 'none',
              capturedAt: new Date().toISOString(),
              valueFrom: got.ok ? 'book-page' : 'manual',
            }, { note })
            return send(200, {
              ok: true, created: true, bookKey: ref.bookKey, fetched: got.ok,
              pending: !got.ok, note: got.ok ? '已加入书签（' + (got.title || ref.key) + '）' : '已加入书签，但取不到书页信息：先用你的备注兜底显示，标记「待补」',
            })
          }
          if (p === '/api/rank-scan/bookmark/refresh') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const body = await readBody(req)
            const keys: string[] = Array.isArray(body.bookKeys) ? body.bookKeys.map(String) : (body.bookKey ? [String(body.bookKey)] : [])
            if (!keys.length) return send(400, { error: 'bookKeys 必填（数组）或 bookKey（单条）' })
            const svc = BOOKMARKS!
            const all = svc.all()
            const out: any[] = []
            let done = 0
            for (const k of keys) {
              const bm = all.find((b) => b.bookKey === k)
              if (!bm) { out.push({ bookKey: k, ok: false, error: '没有这条书签' }); continue }
              // ★ 2026-10-17（1）：删掉显式 sleep —— refreshBookmarkByBookPage 走的 fetchBookProfile 全部带 rateLimit 闸门
              done++
              try { const ok = await refreshBookmarkByBookPage(bm); out.push({ bookKey: k, ok }) }
              catch (e) { out.push({ bookKey: k, ok: false, error: String(e).slice(0, 60) }) }
            }
            return send(200, { ok: true, requests: done, results: out, note: '已刷新 ' + out.filter((x) => x.ok).length + '/' + keys.length + ' 条（' + done + ' 请求）' })
          }
          if (p === '/api/rank-scan/bookmark/export') {
            const svc = BOOKMARKS!
            const format = q.get('format') === 'md' ? 'md' : q.get('format') === 'csv' ? 'csv' : 'json'
            const keys = q.get('keys') ? String(q.get('keys')).split(',').map((s) => s.trim()).filter(Boolean) : null
            const data = svc.exportData(format as any, { bookKeys: keys, includeTrash: q.get('trash') === '1' })
            if (q.get('download') === '1') {
              // ★ 2026-10-16（使用者需求）：真的当文件下载 —— 旧版只在标签页里显示一段文本，用户拿不到文件
              const fname = 'rank-scan-bookmarks-' + localDate(clock.now()) + (keys ? '-selected' : '') + '.' + format
              res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"')
              res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8')
              res.end('\uFEFF' + data.content) // BOM：Excel/记事本打开中文不乱码
              return
            }
            return send(200, { ok: true, format: data.format, count: data.count, content: data.content, note: keys ? '已按选择导出 ' + data.count + ' 条' : '不含回收站' })
          }
          if (p === '/api/rank-scan/bookmark/export-file') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const svc2 = BOOKMARKS!
            const body2 = await readBody(req)
            const format = body2.format === 'md' ? 'md' : body2.format === 'csv' ? 'csv' : 'json'
            const keys = Array.isArray(body2.bookKeys) ? body2.bookKeys.map(String) : null
            const dest = resolve(String(body2.dest || '').trim() || join(homedir(), 'Documents', 'rank-scan-export'))
            const rel0 = relative(resolve(homedir()), dest)
            if (!rel0 || rel0 === '..' || rel0.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(rel0)) return send(400, { error: '导出目录必须位于用户目录的子目录内' })
            const data = svc2.exportData(format as any, { bookKeys: keys, includeTrash: body2.includeTrash === true })
            // ★ 2026-10-16（疑问「是不是会覆盖」）：文件名带**到秒的时间戳**，同名再自动加序号
            //   ⇒ 同一天多次导出、不同选择集导出都不会互相覆盖。
            const d0 = clock.now()
            const p2 = (n: number) => String(n).padStart(2, '0')
            const stampId = d0.getFullYear() + '-' + p2(d0.getMonth() + 1) + '-' + p2(d0.getDate()) + '-' + p2(d0.getHours()) + p2(d0.getMinutes()) + p2(d0.getSeconds())
            const fname = 'rank-scan-bookmarks-' + stampId + (keys && keys.length ? '-selected' : '') + '.' + format
            try {
              mkdirSync(dest, { recursive: true })
              let file = join(dest, fname)
              for (let i = 2; existsSync(file) && i < 1000; i++) file = join(dest, fname.replace(/\.([a-z]+)$/, '-' + i + '.$1'))
              writeFileSync(file, '\uFEFF' + data.content, 'utf8')
              ctx.logger?.info?.('[' + name + '] 导出 ' + data.count + ' 条书签 → ' + file)
              return send(200, { ok: true, path: file, dir: dest, count: data.count, note: '已导出 ' + data.count + ' 条到 ' + file })
            } catch (e) {
              return send(500, { error: '写文件失败：' + (e instanceof Error ? e.message : String(e)) })
            }
          }
          if (p === '/api/rank-scan/bookmark/open-folder') {
            if (String(req.method || 'GET').toUpperCase() !== 'POST') return send(405, { error: 'POST only' })
            const body3 = await readBody(req)
            const dir = String(body3.path || '').trim() || join(homedir(), 'Documents', 'rank-scan-export')
            if (!existsSync(dir)) return send(400, { error: '目录还不存在：' + dir + '（先导出一次就会创建）' })
            const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
            try {
              const child = spawn(cmd, [dir], { detached: true, stdio: 'ignore' })
              child.on('error', (err: Error) => { ctx.logger?.info?.('[' + name + '] 打开目录失败：' + String(err.message).slice(0, 120)) })
              child.unref()
              return send(200, { ok: true, opened: dir })
            } catch (e) {
              return send(500, { error: '打不开：' + (e instanceof Error ? e.message : String(e)) })
            }
          }
          return send(404, { error: '未知路由' })
        } catch (e) {
          return send(500, { error: e instanceof Error ? e.message : String(e) })
        }
      },
    })
    if (typeof ctx.effect === 'function') ctx.effect(() => route())
    else route()
  }
  // 运行时注入的实例常常拿不到直取的 ctx.webServer（apply 时服务尚未暴露）⇒ 先直取，再走依赖光纤晚绑定
  if (server) bindRoute(server)
  else if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx: any) => {
      const s = (webCtx.reflect && typeof webCtx.reflect.get === 'function') ? webCtx.reflect.get('webServer') : webCtx.webServer
      bindRoute(s || webCtx.webServer)
    })
  } else {
    bindRoute(null)
  }

  // 与 webServer 同样的「直取 + 晚绑定」两段式：运行时注入的实例常常拿不到直取的 ctx.timer
  const timerSvc: any = (ctx as any).timer
  if (!bindTimer(timerSvc) && typeof ctx.inject === 'function') {
    try {
      ctx.inject(['timer'], (tCtx: any) => {
        const t = (tCtx && tCtx.reflect && typeof tCtx.reflect.get === 'function') ? tCtx.reflect.get('timer') : (tCtx && tCtx.timer)
        if (!bindTimer(t)) ctx.logger?.info?.('[' + name + '] timer 服务不可用：定时扫描未接线（面板仍可手动扫）')
      })
    } catch (e) {
      ctx.logger?.info?.('[' + name + '] timer 接线失败：' + String(e).slice(0, 80))
    }
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => () => {
    try { timerState.disposer?.() } finally { timerState.disposer = null }
  })
}
