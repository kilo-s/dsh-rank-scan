import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Row, Snapshot } from './types.js'
import { addDays } from './diff.js'
import { deriveFanqieViews, weekStart, type SnapshotLike } from './derive.js'
import { decodePua, hasPua, loadFontMap } from './fontmap.js'
import { bookKeyOf, parseBookInput, type SiteId } from './bookmark-parse.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PUA_RE = /[\uE000-\uF8FF]/
const PUA_GLOBAL_RE = /[\uE000-\uF8FF]/g
const SAFE_CARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/
const BOOK_KEY_RE = /^(qidian|qidiantu|fanqie|ciweimao|sfacg):(\d+)$/

const SITE_CN: Record<string, string> = {
  qidian: '起点',
  qidiantu: '起点',
  fanqie: '番茄',
  ciweimao: '刺猬猫',
  sfacg: '菠萝包',
}

export type OverviewCardType =
  | 'watch'
  | 'plat-qidian'
  | 'plat-fanqie'
  | 'plat-ciweimao'
  | 'plat-sfacg'
  | 'weekly-race'
  | 'book-compare'
  | 'keywords'
export type OverviewCardSpan = 'full' | 'half'

export interface OverviewCardSpec {
  id: string
  type: OverviewCardType
  span: OverviewCardSpan
  visible: boolean
  config?: Record<string, unknown>
}

export interface OverviewLayout {
  version: number
  cards: OverviewCardSpec[]
}

const VALID_CARD_TYPES = new Set<OverviewCardType>([
  'watch',
  'plat-qidian',
  'plat-fanqie',
  'plat-ciweimao',
  'plat-sfacg',
  'weekly-race',
  'book-compare',
  'keywords',
])

const PLAT_CARD_IDS: OverviewCardType[] = ['plat-qidian', 'plat-fanqie', 'plat-ciweimao', 'plat-sfacg']

export const DEFAULT_OVERVIEW_LAYOUT: OverviewLayout = {
  version: 2,
  cards: [
    { id: 'watch', type: 'watch', span: 'full', visible: true },
    { id: 'plat-qidian', type: 'plat-qidian', span: 'half', visible: true },
    { id: 'plat-fanqie', type: 'plat-fanqie', span: 'half', visible: true },
    { id: 'plat-ciweimao', type: 'plat-ciweimao', span: 'half', visible: true },
    { id: 'plat-sfacg', type: 'plat-sfacg', span: 'half', visible: true },
    { id: 'weekly-race', type: 'weekly-race', span: 'full', visible: true, config: { source: 'sanjiang', mode: 'daily' } },
    { id: 'book-compare', type: 'book-compare', span: 'full', visible: true, config: { xAxis: 'date', yAxis: 'value', days: 30, compareKeys: [] } },
    { id: 'keywords', type: 'keywords', span: 'full', visible: true, config: { days: 30 } },
  ],
}

function sanitizeCardConfig(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, unknown> = {}
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, 20)
  for (const [k, v] of entries) {
    if (!k || k.length > 40) continue
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = typeof v === 'string' ? v.slice(0, 200) : v
    } else if (Array.isArray(v)) {
      out[k] = v
        .slice(0, 24)
        .filter((x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')
        .map((x) => (typeof x === 'string' ? x.slice(0, 120) : x))
    }
  }
  return Object.keys(out).length ? out : undefined
}

export function normalizeOverviewLayout(raw: unknown): OverviewLayout {
  const defaultById = new Map(DEFAULT_OVERVIEW_LAYOUT.cards.map((c) => [c.id, c]))
  const srcCards = raw && typeof raw === 'object' && Array.isArray((raw as any).cards)
    ? ((raw as any).cards as unknown[])
    : null
  if (!srcCards || !srcCards.length) {
    return {
      version: 2,
      cards: DEFAULT_OVERVIEW_LAYOUT.cards.map((c) => ({ ...c, ...(c.config ? { config: { ...c.config } } : {}) })),
    }
  }
  const seen = new Set<string>()
  const cards: OverviewCardSpec[] = []
  for (const item of srcCards) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = typeof rec.id === 'string' ? rec.id.trim() : ''
    const rawType = typeof rec.type === 'string' ? rec.type.trim() : ''
    // 兼容迁移 v1 的整体 platforms 卡 → 拆为四张可独立拖拽的平台卡
    if (rawType === 'platforms') {
      const vis = rec.visible !== false
      for (const pt of PLAT_CARD_IDS) {
        if (seen.has(pt)) continue
        seen.add(pt)
        cards.push({ id: pt, type: pt, span: 'half', visible: vis })
      }
      continue
    }
    const type = rawType as OverviewCardType
    if (!id || !SAFE_CARD_ID_RE.test(id) || seen.has(id)) continue
    if (!type || !VALID_CARD_TYPES.has(type)) continue
    seen.add(id)
    const defSpan = defaultById.get(id)?.span || 'full'
    const span: OverviewCardSpan = rec.span === 'half' ? 'half' : (rec.span === 'full' ? 'full' : defSpan)
    const visible = rec.visible !== false
    const cfg = sanitizeCardConfig(rec.config)
    cards.push(cfg ? { id, type, span, visible, config: cfg } : { id, type, span, visible })
    if (cards.length >= 20) break
  }
  // 确保核心内建卡片始终存在于卡片目录中（如版本升级新增卡片则默认追加；已被用户隐藏的保持 visible:false）
  for (const def of DEFAULT_OVERVIEW_LAYOUT.cards) {
    if (!seen.has(def.id)) {
      seen.add(def.id)
      cards.push({ ...def, ...(def.config ? { config: { ...def.config } } : {}) })
    } else {
      const cur = cards.find((c) => c.id === def.id)
      if (cur && def.config) {
        cur.config = { ...def.config, ...(cur.config || {}) }
      }
    }
  }
  if (!cards.length) {
    return {
      version: 2,
      cards: [...defaultById.values()].map((c) => ({ ...c, ...(c.config ? { config: { ...c.config } } : {}) })),
    }
  }
  return { version: 2, cards }
}

function listDataDates(root: string): string[] {
  if (!root || !existsSync(root)) return []
  try {
    return readdirSync(root).filter((d) => DATE_RE.test(d)).sort()
  } catch {
    return []
  }
}

function readJsonSafe<T>(fp: string): T | null {
  try {
    if (!existsSync(fp)) return null
    return JSON.parse(readFileSync(fp, 'utf8')) as T
  } catch {
    return null
  }
}

function numVal(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function normalizeBookKey(raw: string): { site: SiteId; ns: string; id: string; bookKey: string } | null {
  const m = String(raw || '').trim().match(BOOK_KEY_RE)
  if (!m) return null
  const site = m[1] as SiteId
  const id = m[2]
  const ns = site === 'qidiantu' ? 'qidian' : site
  return { site: ns as SiteId, ns, id, bookKey: ns + ':' + id }
}

function fileMtime(fp: string): number {
  try {
    return Math.round(statSync(fp).mtimeMs)
  } catch {
    return 0
  }
}

function dirStamp(root: string, date: string | undefined): number {
  if (!date) return 0
  return fileMtime(join(root, date))
}

/** 与面板主口径一致：忽略带 .untrusted.json 隔离标记的异常快照 */
function isUntrustedSnap(root: string, date: string, boardId: string): boolean {
  return existsSync(join(root, date, boardId + '.untrusted.json'))
}

function putBoundedCache<V>(cache: Map<string, V>, key: string, val: V, maxSize: number): void {
  if (cache.size >= maxSize) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
  cache.set(key, val)
}

const BOOK_VAL_CACHE = new Map<string, Map<string, { collect: number | null; words: number | null }>>()

function readBookValueCaches(root: string): Map<string, { collect: number | null; words: number | null }> {
  const f1 = join(root, 'state', 'book-page-cache.json')
  const f2 = join(root, 'state', 'qidian-book-cache.json')
  const ck = root + '|' + fileMtime(f1) + '|' + fileMtime(f2)
  const hit = BOOK_VAL_CACHE.get(ck)
  if (hit) return hit

  const out = new Map<string, { collect: number | null; words: number | null }>()
  for (const fp of [f1, f2]) {
    const j = readJsonSafe<any>(fp)
    if (!j || typeof j !== 'object') continue
    const entries = j.entries || j.books || j
    if (!entries || typeof entries !== 'object') continue
    for (const [k, v] of Object.entries(entries)) {
      if (!v || typeof v !== 'object') continue
      const rec = v as Record<string, unknown>
      const collect = numVal(rec.collect) ?? numVal(rec.readCount) ?? null
      const words = numVal(rec.wordsCnt) ?? numVal(rec.words) ?? numVal(rec.wordNumber) ?? null
      if (collect == null && words == null) continue
      const idPart = String(k).split(':').pop() || ''
      if (!idPart) continue
      const prev = out.get(idPart)
      if (!prev) {
        out.set(idPart, { collect, words })
      } else {
        out.set(idPart, {
          collect: collect != null && (prev.collect == null || collect > prev.collect) ? collect : prev.collect,
          words: words != null && (prev.words == null || words > prev.words) ? words : prev.words,
        })
      }
      if (k.includes(':')) {
        const prevK = out.get(k)
        if (!prevK) out.set(k, { collect, words })
        else {
          out.set(k, {
            collect: collect != null && (prevK.collect == null || collect > prevK.collect) ? collect : prevK.collect,
            words: words != null && (prevK.words == null || words > prevK.words) ? words : prevK.words,
          })
        }
      }
    }
  }
  putBoundedCache(BOOK_VAL_CACHE, ck, out, 4)
  return out
}

// =============================================================================
// 1. 周榜竞速（起点·三江 17 本 & 番茄·在读周榜 Top 20）
// =============================================================================

export interface WeeklyRacePeriod {
  key: string
  label: string
  periodStart: string
  periodEnd: string
  dataDate: string
  settledDays: number
  count: number
}

export interface WeeklyRaceBook {
  bookKey: string
  key: string
  rank: number
  title: string
  author: string | null
  url: string | null
  cat: string | null
  level: string | null
  baseValue: number | null
  words: number | null
  shouding: number | null
  totalDelta: number | null
  latestDelta: number | null
  daily: (number | null)[]
  cumulative: (number | null)[]
}

export interface WeeklyRaceResult {
  ok: true
  source: 'sanjiang' | 'fanqie'
  title: string
  metricLabel: string
  period: WeeklyRacePeriod | null
  periods: WeeklyRacePeriod[]
  dates: string[]
  categories: Array<{ name: string; count: number }>
  selectedCat: string
  books: WeeklyRaceBook[]
  note: string | null
}

function buildCumulative(daily: (number | null)[]): (number | null)[] {
  let sum = 0
  let started = false
  return daily.map((d) => {
    if (d == null) return null
    sum += d
    started = true
    return started ? sum : null
  })
}

function latestNonNull(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i]
  }
  return null
}

const WEEKLY_RACE_CACHE = new Map<string, WeeklyRaceResult>()

export function computeWeeklyRace(
  root: string,
  opts: { source?: string; period?: string | null; cat?: string | null } = {},
): WeeklyRaceResult {
  const source: 'sanjiang' | 'fanqie' = opts.source === 'fanqie' ? 'fanqie' : 'sanjiang'
  const allDates = listDataDates(root)
  const wantedPeriod = opts.period ? String(opts.period).trim() : ''
  const wantedCat = opts.cat ? String(opts.cat).trim() : ''
  const latestDate = allDates[allDates.length - 1]
  const wrKey = [root, source, wantedPeriod, wantedCat, allDates.length, latestDate || '', dirStamp(root, latestDate)].join('|')
  const wrCached = WEEKLY_RACE_CACHE.get(wrKey)
  if (wrCached) return wrCached

  const retWeekly = (res: WeeklyRaceResult): WeeklyRaceResult => {
    putBoundedCache(WEEKLY_RACE_CACHE, wrKey, res, 16)
    return res
  }

  if (source === 'sanjiang') {
    const byPeriod = new Map<string, { periodStart: string; periodEnd: string; dataDate: string; settledDays: number; snap: Snapshot }>()
    for (const d of allDates) {
      if (isUntrustedSnap(root, d, 'qidiantu.sanjiang')) continue
      const fp = join(root, d, 'qidiantu.sanjiang.json')
      if (!existsSync(fp)) continue
      const snap = readJsonSafe<Snapshot>(fp)
      if (!snap || !Array.isArray(snap.rows) || !snap.rows.length) continue
      const firstEx = (snap.rows[0]?.extra || {}) as Record<string, unknown>
      const dailyArr = Array.isArray(firstEx.daily) ? (firstEx.daily as Array<{ date?: string; delta?: number | null }>) : []
      const pStart = typeof firstEx.periodStart === 'string' && DATE_RE.test(firstEx.periodStart)
        ? firstEx.periodStart
        : (dailyArr[0]?.date && DATE_RE.test(dailyArr[0].date) ? addDays(dailyArr[0].date, -1) : d)
      const pEnd = dailyArr.length >= 7 && dailyArr[6]?.date && DATE_RE.test(dailyArr[6].date)
        ? dailyArr[6].date
        : addDays(pStart, 7)
      const settledDays = numVal(firstEx.settledDays) ?? dailyArr.filter((x) => numVal(x?.delta) != null).length
      const prev = byPeriod.get(pStart)
      if (!prev || d >= prev.dataDate) {
        byPeriod.set(pStart, { periodStart: pStart, periodEnd: pEnd, dataDate: d, settledDays, snap })
      }
    }

    const periodList = [...byPeriod.values()].sort((a, b) => b.periodStart.localeCompare(a.periodStart))
    const periods: WeeklyRacePeriod[] = periodList.map((p) => ({
      key: p.periodStart,
      label: p.periodStart.slice(5) + ' 期 · ' + p.settledDays + '/7天',
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      dataDate: p.dataDate,
      settledDays: p.settledDays,
      count: p.snap.rows.length,
    }))

    const picked = (wantedPeriod ? periodList.find((p) => p.periodStart === wantedPeriod) : null) || periodList[0] || null
    if (!picked) {
      return {
        ok: true,
        source: 'sanjiang',
        title: '起点·三江推荐效果',
        metricLabel: '收藏增量',
        period: null,
        periods: [],
        dates: [],
        categories: [],
        selectedCat: '',
        books: [],
        note: '本地还没有起点图三江榜快照',
      }
    }

    const sampleDaily = Array.isArray((picked.snap.rows[0]?.extra as any)?.daily)
      ? ((picked.snap.rows[0].extra as any).daily as Array<{ date?: string }>)
      : []
    const dates: string[] = []
    for (let i = 0; i < 7; i++) {
      dates.push(sampleDaily[i]?.date && DATE_RE.test(sampleDaily[i].date!) ? sampleDaily[i].date! : addDays(picked.periodStart, i + 1))
    }

    const catCount = new Map<string, number>()
    const rawBooks: WeeklyRaceBook[] = picked.snap.rows.map((r, idx) => {
      const ex = (r.extra || {}) as Record<string, unknown>
      const rawDaily = Array.isArray(ex.daily) ? (ex.daily as Array<{ delta?: unknown }>) : []
      const daily: (number | null)[] = []
      for (let i = 0; i < 7; i++) daily.push(numVal(rawDaily[i]?.delta))
      const cumulative = buildCumulative(daily)
      const latestD = latestNonNull(daily)
      const totalDelta = numVal(ex.totalDelta) ?? latestNonNull(cumulative) ?? numVal(r.value)
      const cat = typeof ex.cat === 'string' && ex.cat.trim() ? ex.cat.trim() : null
      if (cat) catCount.set(cat, (catCount.get(cat) || 0) + 1)
      return {
        bookKey: bookKeyOf('qidian', String(r.key)),
        key: String(r.key),
        rank: typeof r.rank === 'number' ? r.rank : idx + 1,
        title: String(r.title || r.key),
        author: r.author || null,
        url: r.url || ('https://www.qidian.com/book/' + r.key + '/'),
        cat,
        level: typeof ex.level === 'string' ? ex.level : null,
        baseValue: numVal(ex.collectBase),
        words: numVal(ex.wordsCnt) ?? numVal(ex.words),
        shouding: numVal(ex.shouding),
        totalDelta,
        latestDelta: latestD,
        daily,
        cumulative,
      }
    })

    const categories = [...catCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))

    const filtered = wantedCat && wantedCat !== '全部'
      ? rawBooks.filter((b) => b.cat === wantedCat)
      : rawBooks

    filtered.sort((a, b) => (b.totalDelta ?? -Infinity) - (a.totalDelta ?? -Infinity))
    filtered.forEach((b, i) => { b.rank = i + 1 })

    const activeMeta = periods.find((p) => p.key === picked.periodStart) || periods[0]
    return retWeekly({
      ok: true,
      source: 'sanjiang',
      title: '起点·三江推荐效果',
      metricLabel: '收藏增量',
      period: activeMeta,
      periods,
      dates,
      categories,
      selectedCat: wantedCat && wantedCat !== '全部' ? wantedCat : '',
      books: filtered,
      note: '期首日 ' + picked.periodStart + ' · 已结算 ' + picked.settledDays + '/7 天（共 ' + picked.snap.rows.length + ' 本）',
    })
  }

  // === source === 'fanqie' ===
  const fanqieBoardsSet = new Set<string>()
  const fanqieDates: string[] = []
  const byWeek = new Map<string, string[]>()

  for (const d of allDates) {
    const dir = join(root, d)
    let files: string[] = []
    try { files = readdirSync(dir) } catch { continue }
    const fqFiles = files.filter((f) => {
      if (!f.startsWith('fanqie.m.') || !f.endsWith('.json') || f.endsWith('.untrusted.json')) return false
      return !isUntrustedSnap(root, d, f.replace(/\.json$/, ''))
    })
    if (!fqFiles.length) continue
    fanqieDates.push(d)
    for (const f of fqFiles) fanqieBoardsSet.add(f.replace(/\.json$/, ''))
    const ws = weekStart(d)
    const arr = byWeek.get(ws) || []
    arr.push(d)
    byWeek.set(ws, arr)
  }

  const poolBoards = [...fanqieBoardsSet].sort()
  const weekEntries = [...byWeek.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  const periods: WeeklyRacePeriod[] = weekEntries.map(([ws, ds]) => {
    const end = addDays(ws, 6)
    return {
      key: ws,
      label: ws.slice(5) + ' ~ ' + end.slice(5) + ' · ' + ds.length + '/7天',
      periodStart: ws,
      periodEnd: end,
      dataDate: ds[ds.length - 1],
      settledDays: ds.length,
      count: 0,
    }
  })

  const pickedWeek = (wantedPeriod ? weekEntries.find(([ws]) => ws === wantedPeriod) : null) || weekEntries[0] || null
  if (!pickedWeek || !poolBoards.length) {
    return {
      ok: true,
      source: 'fanqie',
      title: '番茄·在读周榜 Top 20',
      metricLabel: '在读增量',
      period: null,
      periods: [],
      dates: [],
      categories: [],
      selectedCat: '',
      books: [],
      note: '本地还没有番茄分类榜快照',
    }
  }

  const [ws, ds] = pickedWeek
  const latestDayInWeek = ds[ds.length - 1]
  const readSnap = (boardId: string, date: string): SnapshotLike | null => {
    if (isUntrustedSnap(root, date, boardId)) return null
    const snap = readJsonSafe<Snapshot>(join(root, date, boardId + '.json'))
    return snap && Array.isArray(snap.rows) ? snap : null
  }
  const views = deriveFanqieViews(readSnap, { date: latestDayInWeek, poolBoards, dataDates: fanqieDates })
  const view = views[0]
  const fmap = loadFontMap(root)
  const hasFmap = Object.keys(fmap).length > 0

  const dates: string[] = []
  for (let i = 0; i < 7; i++) dates.push(addDays(ws, i))

  const catCount = new Map<string, number>()
  const allRows: WeeklyRaceBook[] = ((view && view.rows) || []).map((r, idx) => {
    const ex = (r.extra || {}) as Record<string, unknown>
    const pdaysRaw = Array.isArray(ex.pdays) ? (ex.pdays as unknown[]) : []
    const daily: (number | null)[] = []
    for (let i = 0; i < 7; i++) daily.push(numVal(pdaysRaw[i]))
    const cumulative = buildCumulative(daily)
    const totalDelta = numVal(ex.periodDelta) ?? latestNonNull(cumulative)
    const latestD = numVal(ex.gain) ?? latestNonNull(daily)
    const cat = typeof ex.cat === 'string' && ex.cat.trim() ? ex.cat.trim() : null
    if (cat) catCount.set(cat, (catCount.get(cat) || 0) + 1)
    let title = String(r.title || r.key)
    let author = r.author || null
    if (hasFmap) {
      if (hasPua(title)) title = decodePua(title, fmap).text
      if (author && hasPua(author)) author = decodePua(author, fmap).text
    }
    return {
      bookKey: bookKeyOf('fanqie', String(r.key)),
      key: String(r.key),
      rank: idx + 1,
      title,
      author,
      url: r.url || ('https://fanqienovel.com/page/' + r.key),
      cat,
      level: null,
      baseValue: numVal(ex.read),
      words: numVal(ex.words),
      shouding: null,
      totalDelta,
      latestDelta: latestD,
      daily,
      cumulative,
    }
  })

  const categories = [...catCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))

  const filtered = wantedCat && wantedCat !== '全部'
    ? allRows.filter((b) => b.cat === wantedCat)
    : allRows

  // 稳定按本周累计涨幅排序（缺累计时退回最新日涨幅），取 Top 20
  filtered.sort((a, b) => {
    const av = a.totalDelta ?? a.latestDelta ?? -Infinity
    const bv = b.totalDelta ?? b.latestDelta ?? -Infinity
    return bv - av
  })
  const top20 = filtered.slice(0, 20)
  top20.forEach((b, i) => { b.rank = i + 1 })

  const activeMeta = periods.find((p) => p.key === ws) || periods[0]
  if (activeMeta) activeMeta.count = filtered.length

  return retWeekly({
    ok: true,
    source: 'fanqie',
    title: '番茄·在读周榜 Top 20',
    metricLabel: '在读增量',
    period: activeMeta,
    periods,
    dates,
    categories,
    selectedCat: wantedCat && wantedCat !== '全部' ? wantedCat : '',
    books: top20,
    note: view ? view.note : null,
  })
}

// =============================================================================
// 2. 多书成长曲线对比 & 本地作品搜索
// =============================================================================

export interface BookmarkHint {
  bookKey: string
  title?: string | null
  label?: string | null
  author?: string | null
  url?: string | null
  site?: string | null
  watched?: boolean
}

export interface BookSeriesPoint {
  date: string
  value: number | null
  rank: number | null
  words: number | null
  pct: number | null
}

export interface BookSeriesItem {
  bookKey: string
  site: string
  siteName: string
  title: string
  author: string | null
  url: string | null
  cat: string | null
  metricLabel: string
  latestValue: number | null
  latestRank: number | null
  latestWords: number | null
  shouding: { date: string; value: number; collect: number | null; words: number | null; label: string } | null
  points: BookSeriesPoint[]
}

export interface BookSeriesResult {
  ok: true
  days: number
  dates: string[]
  books: BookSeriesItem[]
}

function siteFromBoardFile(fname: string): 'qidian' | 'fanqie' | 'ciweimao' | 'sfacg' | null {
  if (fname.startsWith('fanqie.')) return 'fanqie'
  if (fname.startsWith('qidian.') || fname.startsWith('qidiantu.')) return 'qidian'
  if (fname.startsWith('ciweimao.')) return 'ciweimao'
  if (fname.startsWith('sfacg.')) return 'sfacg'
  return null
}

function extractRowMetric(site: string, boardId: string, r: Row): { value: number | null; words: number | null; rank: number | null; cat: string | null } {
  const ex = (r.extra || {}) as Record<string, unknown>
  const words = numVal(ex.wordsCnt) ?? numVal(ex.wordNumber) ?? numVal(ex.words) ?? null
  const cat = typeof ex.cat === 'string' && ex.cat.trim() ? ex.cat.trim() : null
  const isBatch = boardId === 'qidiantu.shouding' || boardId === 'ciweimao.buy.latest'
  const rank = !isBatch && typeof r.rank === 'number' && Number.isFinite(r.rank) ? r.rank : null

  let value: number | null = null
  if (site === 'fanqie') {
    value = numVal(r.value) ?? numVal(ex.read)
  } else if (boardId === 'qidiantu.sanjiang') {
    const base = numVal(ex.collectBase)
    const td = numVal(ex.totalDelta)
    value = base != null ? base + (td ?? 0) : null
  } else if (boardId === 'qidiantu.shouding' || boardId === 'ciweimao.buy.latest') {
    value = numVal(ex.collect)
  } else {
    value = numVal(ex.collect) ?? numVal(ex.popularity) ?? numVal(r.value)
  }
  return { value, words, rank, cat }
}

export function computeBookSeries(
  root: string,
  opts: { bookKeys: string[]; days?: number; bookmarks?: BookmarkHint[] },
): BookSeriesResult {
  const daysRaw = Number(opts.days ?? 30)
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(180, Math.max(7, Math.round(daysRaw))) : 0
  const normList: Array<{ ns: string; id: string; bookKey: string }> = []
  const seenKeys = new Set<string>()
  for (const raw of opts.bookKeys || []) {
    const n = normalizeBookKey(raw)
    if (!n || seenKeys.has(n.bookKey)) continue
    seenKeys.add(n.bookKey)
    normList.push(n)
    if (normList.length >= 12) break
  }

  if (!normList.length) {
    return { ok: true, days, dates: [], books: [] }
  }

  const allDates = listDataDates(root)
  const useDates = days > 0 ? allDates.slice(-days) : allDates.slice(-180)
  const neededSites = new Set(normList.map((x) => x.ns))
  const byIdAndSite = new Map<string, string>() // site::id -> bookKey
  for (const x of normList) byIdAndSite.set(x.ns + '::' + x.id, x.bookKey)

  const bmMap = new Map<string, BookmarkHint>()
  for (const bm of opts.bookmarks || []) {
    if (bm && bm.bookKey) bmMap.set(bm.bookKey, bm)
  }

  const caches = readBookValueCaches(root)
  const fmap = loadFontMap(root)
  const hasFmap = Object.keys(fmap).length > 0

  interface Acc {
    bookKey: string
    site: string
    id: string
    title: string
    author: string | null
    url: string | null
    cat: string | null
    shouding: { date: string; value: number; collect: number | null; words: number | null; label: string } | null
    byDate: Map<string, { value: number | null; rank: number | null; words: number | null }>
  }

  const accs = new Map<string, Acc>()
  for (const x of normList) {
    const bm = bmMap.get(x.bookKey)
    accs.set(x.bookKey, {
      bookKey: x.bookKey,
      site: x.ns,
      id: x.id,
      title: (bm && (bm.title || bm.label)) || x.bookKey,
      author: (bm && bm.author) || null,
      url: (bm && bm.url) || null,
      cat: null,
      shouding: null,
      byDate: new Map(),
    })
  }

  const unionDates = new Set<string>()
  for (const d of useDates) {
    const dir = join(root, d)
    let files: string[] = []
    try { files = readdirSync(dir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.json') || f === 'scan.json' || f === 'day-index.json' || f.endsWith('.untrusted.json')) continue
      const stSite = siteFromBoardFile(f)
      if (!stSite || !neededSites.has(stSite)) continue
      const boardId = f.replace(/\.json$/, '')
      if (isUntrustedSnap(root, d, boardId)) continue
      const snap = readJsonSafe<Snapshot>(join(dir, f))
      if (!snap || !Array.isArray(snap.rows)) continue
      for (const r of snap.rows) {
        const bk = byIdAndSite.get(stSite + '::' + String(r.key))
        if (!bk) continue
        const acc = accs.get(bk)!
        let title = String(r.title || '').trim()
        let author = r.author || null
        if (stSite === 'fanqie' && hasFmap) {
          if (hasPua(title)) title = decodePua(title, fmap).text
          if (author && hasPua(author)) author = decodePua(author, fmap).text
        }
        if (title && !PUA_RE.test(title) && (acc.title === acc.bookKey || title.length >= acc.title.length)) {
          acc.title = title
        }
        if (author && !acc.author) acc.author = author
        if (r.url && !acc.url) acc.url = r.url

        const m = extractRowMetric(stSite, boardId, r)
        if (m.cat && !acc.cat) acc.cat = m.cat

        // 毕业/首订节点识别
        const ex = (r.extra || {}) as Record<string, unknown>
        if (boardId === 'qidiantu.shouding' && numVal(r.value) != null) {
          const sdDate = typeof ex.showDate === 'string' && DATE_RE.test(ex.showDate) ? ex.showDate : d
          acc.shouding = {
            date: sdDate,
            value: numVal(r.value)!,
            collect: numVal(ex.collect),
            words: m.words,
            label: '首订 ' + numVal(r.value)!,
          }
        } else if (boardId === 'ciweimao.buy.latest' && numVal(r.value) != null) {
          const fba = typeof ex.firstBuyableAt === 'string' && ex.firstBuyableAt.length >= 10 ? ex.firstBuyableAt.slice(0, 10) : d
          acc.shouding = {
            date: fba,
            value: numVal(r.value)!,
            collect: numVal(ex.collect),
            words: m.words,
            label: '首订(约) ' + numVal(r.value)!,
          }
        } else if (boardId === 'qidiantu.sanjiang' && numVal(ex.shouding) != null && !acc.shouding) {
          acc.shouding = {
            date: d,
            value: numVal(ex.shouding)!,
            collect: m.value,
            words: m.words,
            label: '首订 ' + numVal(ex.shouding)!,
          }
        }

        const prev = acc.byDate.get(d)
        if (!prev) {
          acc.byDate.set(d, { value: m.value, rank: m.rank, words: m.words })
        } else {
          if (m.value != null && (prev.value == null || m.value > prev.value)) prev.value = m.value
          if (m.rank != null && (prev.rank == null || m.rank < prev.rank)) prev.rank = m.rank
          if (m.words != null && (prev.words == null || m.words > prev.words)) prev.words = m.words
        }
        unionDates.add(d)
      }
    }
  }

  const books: BookSeriesItem[] = normList.map((x) => {
    const acc = accs.get(x.bookKey)!
    const cached = caches.get(x.bookKey) || caches.get(x.id) || null
    const sortedDays = [...acc.byDate.keys()].sort()
    let firstVal: number | null = null
    for (const d of sortedDays) {
      const v = acc.byDate.get(d)!.value
      if (v != null && v > 0) { firstVal = v; break }
    }
    const points: BookSeriesPoint[] = sortedDays.map((d) => {
      const p = acc.byDate.get(d)!
      const pct = firstVal != null && p.value != null
        ? +(((p.value - firstVal) / firstVal) * 100).toFixed(1)
        : null
      return { date: d, value: p.value, rank: p.rank, words: p.words, pct }
    })
    // 若最后一点缺字数/收藏，用书页缓存温和补最新点（不伪造历史）
    if (points.length && cached) {
      const last = points[points.length - 1]
      if (last.words == null && cached.words != null) last.words = cached.words
      if (last.value == null && cached.collect != null) last.value = cached.collect
    }
    let latestValue: number | null = null
    let latestRank: number | null = null
    let latestWords: number | null = null
    for (let i = points.length - 1; i >= 0; i--) {
      if (latestValue == null && points[i].value != null) latestValue = points[i].value
      if (latestRank == null && points[i].rank != null) latestRank = points[i].rank
      if (latestWords == null && points[i].words != null) latestWords = points[i].words
    }
    if (latestWords == null && cached?.words != null) latestWords = cached.words
    if (latestValue == null && cached?.collect != null) latestValue = cached.collect
    return {
      bookKey: acc.bookKey,
      site: acc.site,
      siteName: SITE_CN[acc.site] || acc.site,
      title: acc.title,
      author: acc.author,
      url: acc.url,
      cat: acc.cat,
      metricLabel: acc.site === 'fanqie' ? '在读' : '收藏',
      latestValue,
      latestRank,
      latestWords,
      shouding: acc.shouding,
      points,
    }
  })

  return {
    ok: true,
    days,
    dates: [...unionDates].sort(),
    books,
  }
}

export interface SearchBookHit {
  bookKey: string
  site: string
  siteName: string
  title: string
  author: string | null
  url: string | null
  cat: string | null
  latestValue: number | null
  latestDate: string | null
  bookmarked: boolean
  watched: boolean
}

interface IndexedRecentBook {
  bookKey: string
  site: string
  siteName: string
  title: string
  titleLower: string
  author: string | null
  authorLower: string
  url: string | null
  cat: string | null
  latestValue: number | null
  latestDate: string
}

const RECENT_BOOKS_CACHE = new Map<string, IndexedRecentBook[]>()

function getRecentBooksIndex(root: string): IndexedRecentBook[] {
  const recentDates = listDataDates(root).slice(-14).reverse()
  const ck = root + '|' + recentDates.length + '|' + (recentDates[0] || '') + '|' + dirStamp(root, recentDates[0])
  const hit = RECENT_BOOKS_CACHE.get(ck)
  if (hit) return hit

  const fmap = loadFontMap(root)
  const hasFmap = Object.keys(fmap).length > 0
  const byKey = new Map<string, IndexedRecentBook>()
  for (const d of recentDates) {
    const dir = join(root, d)
    let files: string[] = []
    try { files = readdirSync(dir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.json') || f === 'scan.json' || f === 'day-index.json' || f.endsWith('.untrusted.json')) continue
      const stSite = siteFromBoardFile(f)
      if (!stSite) continue
      const boardId = f.replace(/\.json$/, '')
      if (isUntrustedSnap(root, d, boardId)) continue
      const snap = readJsonSafe<Snapshot>(join(dir, f))
      if (!snap || !Array.isArray(snap.rows)) continue
      for (const r of snap.rows) {
        const bk = stSite + ':' + String(r.key)
        let title = String(r.title || '').trim()
        let author = r.author || null
        if (stSite === 'fanqie' && hasFmap) {
          if (hasPua(title)) title = decodePua(title, fmap).text
          if (author && hasPua(author)) author = decodePua(author, fmap).text
        }
        if (!title || PUA_RE.test(title)) continue
        const ex = (r.extra || {}) as Record<string, unknown>
        const m = extractRowMetric(stSite, boardId, r)
        const existing = byKey.get(bk)
        if (existing) {
          if (title.length > existing.title.length) { existing.title = title; existing.titleLower = title.toLowerCase() }
          if (!existing.author && author) { existing.author = author; existing.authorLower = author.toLowerCase() }
          if (!existing.url && r.url) existing.url = r.url
          if (!existing.cat && typeof ex.cat === 'string') existing.cat = ex.cat
          if (existing.latestValue == null && m.value != null) existing.latestValue = m.value
        } else {
          byKey.set(bk, {
            bookKey: bk,
            site: stSite,
            siteName: SITE_CN[stSite] || stSite,
            title,
            titleLower: title.toLowerCase(),
            author,
            authorLower: author ? author.toLowerCase() : '',
            url: r.url || null,
            cat: typeof ex.cat === 'string' ? ex.cat : null,
            latestValue: m.value,
            latestDate: d,
          })
        }
      }
    }
  }
  const list = [...byKey.values()]
  putBoundedCache(RECENT_BOOKS_CACHE, ck, list, 4)
  return list
}

export function searchLocalBooks(
  root: string,
  queryRaw: string,
  limit = 20,
  bookmarks: BookmarkHint[] = [],
): SearchBookHit[] {
  const q = String(queryRaw || '').trim()
  const qLower = q.toLowerCase()
  const parsed = q ? parseBookInput(q) : null
  const cap = Math.min(40, Math.max(1, limit))

  const hits = new Map<string, SearchBookHit>()
  const bmByKey = new Map<string, BookmarkHint>()
  for (const bm of bookmarks) {
    if (!bm || !bm.bookKey) continue
    bmByKey.set(bm.bookKey, bm)
    const ns = bm.bookKey.split(':')[0] || 'qidian'
    const title = String(bm.title || bm.label || bm.bookKey)
    const author = bm.author || null
    const match = !qLower
      || title.toLowerCase().includes(qLower)
      || (author && author.toLowerCase().includes(qLower))
      || bm.bookKey.toLowerCase().includes(qLower)
      || (parsed && parsed.bookKey === bm.bookKey)
    if (match) {
      hits.set(bm.bookKey, {
        bookKey: bm.bookKey,
        site: ns,
        siteName: SITE_CN[ns] || ns,
        title,
        author,
        url: bm.url || null,
        cat: null,
        latestValue: null,
        latestDate: null,
        bookmarked: true,
        watched: bm.watched === true,
      })
    }
  }

  // 直接过滤近 14 天内存索引（避免每次按键同步扫盘数百个 JSON）
  const recentIndex = getRecentBooksIndex(root)
  for (const item of recentIndex) {
    const existing = hits.get(item.bookKey)
    if (existing) {
      if (existing.title === existing.bookKey || item.title.length > existing.title.length) existing.title = item.title
      if (!existing.author && item.author) existing.author = item.author
      if (!existing.url && item.url) existing.url = item.url
      if (!existing.cat && item.cat) existing.cat = item.cat
      if (existing.latestDate == null || item.latestDate > existing.latestDate) {
        existing.latestDate = item.latestDate
        if (item.latestValue != null) existing.latestValue = item.latestValue
      }
      continue
    }
    const match = !qLower
      || item.titleLower.includes(qLower)
      || (item.authorLower && item.authorLower.includes(qLower))
      || item.bookKey.toLowerCase().includes(qLower)
      || (parsed && parsed.bookKey === item.bookKey)
    if (!match) continue
    const bm = bmByKey.get(item.bookKey)
    hits.set(item.bookKey, {
      bookKey: item.bookKey,
      site: item.site,
      siteName: item.siteName,
      title: item.title,
      author: item.author,
      url: item.url,
      cat: item.cat,
      latestValue: item.latestValue,
      latestDate: item.latestDate,
      bookmarked: !!bm,
      watched: !!(bm && bm.watched),
    })
  }

  if (parsed && !hits.has(parsed.bookKey)) {
    const ns = parsed.site === 'qidiantu' ? 'qidian' : parsed.site
    hits.set(parsed.bookKey, {
      bookKey: parsed.bookKey,
      site: ns,
      siteName: SITE_CN[ns] || ns,
      title: parsed.bookKey,
      author: null,
      url: parsed.url,
      cat: null,
      latestValue: null,
      latestDate: null,
      bookmarked: false,
      watched: false,
    })
  }

  const arr = [...hits.values()]
  arr.sort((a, b) => {
    if (parsed) {
      if (a.bookKey === parsed.bookKey) return -1
      if (b.bookKey === parsed.bookKey) return 1
    }
    if (a.watched !== b.watched) return a.watched ? -1 : 1
    if (a.bookmarked !== b.bookmarked) return a.bookmarked ? -1 : 1
    if (qLower) {
      const aSw = a.title.toLowerCase().startsWith(qLower) ? 1 : 0
      const bSw = b.title.toLowerCase().startsWith(qLower) ? 1 : 0
      if (aSw !== bSw) return bSw - aSw
    }
    const dc = (b.latestDate || '').localeCompare(a.latestDate || '')
    if (dc !== 0) return dc
    return (b.latestValue ?? -1) - (a.latestValue ?? -1)
  })
  return arr.slice(0, cap)
}

// =============================================================================
// 3. 188 词超密细分关键词（枢纽衍生树 + 四站独立词云）
// =============================================================================

export type LexiconEntry = readonly [term: string, parent: string | null, aliases: readonly string[]]

/** 188 细分零噪声网文词表（严格 >=2 字别名，避免单字及大分类串味） */
export const FINE_LEXICON: readonly LexiconEntry[] = [
  // === 1. 修仙 / 洪荒 / 高武体系 ===
  ['修仙', null, ['修仙', '修真', '仙侠', '炼气', '筑基', '金丹', '元婴', '飞升', '宗门', '问道', '证道']],
  ['长生', '修仙', ['长生', '寿元', '寿命论', '永生', '不死']],
  ['凡人流', '修仙', ['凡人', '韩立', '灵根', '坊市', '杂役', '散修', '灵石']],
  ['苟道', '修仙', ['苟道', '苟在', '苟着', '稳健', '发育', '不浪', '苟活']],
  ['魔修', '修仙', ['魔修', '邪修', '魔道', '魔门', '魔宗', '魔尊', '合欢宗', '炉鼎']],
  ['剑修', '修仙', ['剑修', '剑仙', '剑道', '剑意', '剑主', '剑娘']],
  ['炼丹制符', '修仙', ['炼丹', '丹药', '符箓', '阵法', '炼器', '符师']],
  ['仙族宗门', '修仙', ['仙族', '老祖', '子嗣', '宗族', '宗主', '圣地']],
  ['双修道侣', '修仙', ['双修', '道侣', '合欢']],
  ['武侠江湖', '修仙', ['武侠', '武林', '江湖', '侠客', '门派', '大侠']],
  ['洪荒', '修仙', ['洪荒', '鸿钧', '巫妖', '紫霄宫', '混沌魔神']],
  ['封神', '洪荒', ['封神', '截教', '阐教', '商周', '姜子牙']],
  ['三清', '洪荒', ['三清', '通天', '太清', '元始', '圣人']],
  ['西游', '洪荒', ['西游', '齐天大圣', '孙悟空', '大圣', '取经', '天庭', '地府', '如来', '黄狮精']],
  ['大帝', '修仙', ['大帝', '禁区', '至尊', '圣体', '帝兵', '红尘仙']],
  ['高武', null, ['高武', '武道', '气血', '武圣', '武神', '宗师', '先天', '肉身', '极道']],
  ['国术', '高武', ['国术', '拳法', '形意', '八极', '咏春', '津门']],
  ['异能', '高武', ['异能', '超能力', 'SSS级', '超凡']],
  ['御兽', '高武', ['御兽', '宠兽', '契约兽', '灵兽', '进化路径']],

  // === 2. 金手指 / 系统机制体系 ===
  ['系统', null, ['系统', '外挂', '金手指']],
  ['觉醒', '系统', ['觉醒', '天赋觉醒']],
  ['面板', '系统', ['面板', '属性面板', '状态栏']],
  ['熟练度', '面板', ['熟练度', '肝经验', '肝成', '放置', '挂机']],
  ['加点', '面板', ['加点', '自由属性']],
  ['词条', '系统', ['词条', '金词条', '神级词条']],
  ['天赋', '系统', ['天赋', '双天赋', '顶级天赋']],
  ['悟性逆天', '天赋', ['悟性', '顿悟']],
  ['每日情报', '系统', ['每日情报', '情报系统', '情报刷新', '每周刷新', '随机刷新', '每年刷新', '每日刷新', '每日结算', '每周指令']],
  ['签到打卡', '系统', ['签到', '打卡']],
  ['暴击返还', '系统', ['暴击', '返还', '万倍返还', '十倍收益', '投资', '收益结算']],
  ['抽卡抽奖', '系统', ['抽卡', '抽奖', '十连', '卡池']],
  ['模拟器', '系统', ['模拟器', '人生模拟', '恋爱模拟', '模拟人生', '模拟人']],
  ['扮演模板', '系统', ['模板', '扮演', '马甲', '人设', '一人千役']],
  ['天幕曝光', '系统', ['天幕', '曝光', '盘点', '剧透', '投影', '名场面']],
  ['直播弹幕', '天幕曝光', ['直播', '弹幕', '人气至上']],
  ['偷听心声', '系统', ['心声', '读心', '日记']],
  ['迪化脑补', '系统', ['迪化', '脑补', '装高人', '认知差']],
  ['无敌流', '系统', ['无敌', '满级', '降维打击', '秒杀']],
  ['幕后黑手', '系统', ['幕后', '创世', '伪装文明', '推手']],
  ['第四天灾', '系统', ['第四天灾', '玩家', '内测', '公测', 'NPC', '联机游戏', '终末地']],
  ['游戏制作', '第四天灾', ['游戏制作', '做游戏', '开发游戏', 'RPG', '防沉迷']],
  ['制卡卡牌', '系统', ['制卡', '卡牌', '卡师', '羁绊']],
  ['转职职业', '系统', ['转职', '隐藏职业', 'F级职业', '职业者']],
  ['肉鸽构筑', '系统', ['肉鸽', '海克斯', '构筑', 'BUG']],
  ['聊天群', '系统', ['聊天群', '群友', '援助群', '视监']],
  ['时间循环', '系统', ['时间循环', '回溯', '读档', '存档', '二周目']],
  ['选择系统', '系统', ['神级选择', '选择系统', '十选九', '选项']],
  ['契约收容', '系统', ['契约', '收容', '异常', '神祇', '信仰']],
  ['退队流', '系统', ['退队流', '退队', '踢出队伍', '白板']],

  // === 3. 诸天 / 同人 / 二次元体系 ===
  ['诸天万界', null, ['诸天', '万界', '无限流', '主神空间', '轮回空间', '次元']],
  ['同时穿越', '诸天万界', ['同时穿越', '共享天赋', '万界遗产', '每个我']],
  ['斗罗', '诸天万界', ['斗罗', '武魂', '魂环', '唐三', '霍雨浩', '史莱克']],
  ['千仞雪', '斗罗', ['千仞雪', '比比东', '武魂殿', '天使神']],
  ['斗罗绝世', '斗罗', ['绝世唐门', '龙王传说', '斗罗绝世', '斗罗龙王']],
  ['斗破遮天', '诸天万界', ['斗破', '遮天', '完美世界', '吞噬星空', '诛仙', '萧炎', '叶凡']],
  ['吞噬星空', '斗破遮天', ['吞噬星空', '罗峰']],
  ['遮天', '斗破遮天', ['遮天', '荒古', '狠人', '无始']],
  ['斗破', '斗破遮天', ['斗破', '斗气', '萧炎', '异火']],
  ['龙族', '诸天万界', ['龙族', '路明非', '卡塞尔', '混血种', '绘梨衣']],
  ['战锤', '诸天万界', ['战锤', '泰拉', '帝皇', '阿斯塔特', '混沌', '火蜥蜴', '40K', '投混']],
  ['美漫', '诸天万界', ['美漫', '漫威', '哥谭', '蝙蝠侠', '复仇者', 'DC', '变种人', '雷神之锤']],
  ['超人', '美漫', ['超人', '氪星', '祖国人', '超人强']],
  ['哈利波特', '诸天万界', ['哈利波特', '霍格沃茨', '马尔福', '邓布利多', '伏地魔', '女巫']],
  ['综漫', null, ['综漫', '二次元']],
  ['星铁', '综漫', ['星铁', '崩铁', '阿哈', '卡芙卡', '黑塔', '流萤', '星神', '罗浮', '仙舟', '令使', '虚构史学家']],
  ['崩坏', '综漫', ['崩坏', '琪亚娜', '爱莉希雅', '芽衣', '律者', '逐火之蛾']],
  ['原神', '综漫', ['原神', '提瓦特', '璃月', '稻妻', '枫丹', '须弥', '纳塔', '七神', '原铁']],
  ['明日方舟', '综漫', ['明日方舟', '方舟', '泰拉', '罗德岛', '博士', '特蕾西娅', '巴别塔', '大炎']],
  ['咒回', '综漫', ['咒回', '咒术', '五条悟', '宿傩', '咒术回战', '六眼', '咒灵', '魔虚罗']],
  ['型月', '综漫', ['型月', '圣杯', '迦勒底', '英灵', '从者', '卫宫', '苍崎青子', 'FGO', 'fate', 'Fate']],
  ['火影', '综漫', ['火影', '木叶', '宇智波', '忍界', '写轮眼', '鸣人', '佐助']],
  ['海贼', '综漫', ['海贼', '海军', '恶魔果实', '草帽', '大将', '四皇', '顶上']],
  ['死神蓝染', '综漫', ['死神', '蓝染', '尸魂界', '斩魄刀', '静灵廷']],
  ['实教', '综漫', ['实教', '高度育成', '绫小路']],
  ['游戏王', '综漫', ['游戏王', '决斗怪兽', '青眼白龙', '烙印']],
  ['赛马娘', '综漫', ['赛马娘', '特雷森', '马娘']],
  ['地错', '综漫', ['地错', '欧拉丽', '眷族']],
  ['乐队MyGO', '综漫', ['乐队', 'MyGO', '素世', '长崎素世', '祥子', '轻音', '女子乐队']],
  ['奥特曼', '综漫', ['奥特曼', '奥特', '梦比优斯', '迪迦', '杰顿', '光之国', '赛罗', '泰罗', '格斗仪']],
  ['假面骑士', '综漫', ['假面骑士', '甲斗', '帝骑', '逢魔', '特摄', '腰带']],
  ['宝可梦', '综漫', ['宝可梦', '神奇宝贝', '训练家', '道馆', '皮卡丘']],
  ['数码宝贝', '综漫', ['数码', '亚古兽', '被选召']],
  ['舰娘', '综漫', ['舰娘', '碧蓝航线', '港区', '指挥官']],
  ['无职转生', '综漫', ['无职', '无职转生', '鲁迪']],
  ['刀剑神域', '综漫', ['刀剑', 'SAO', '茅场晶彦']],
  ['月计脑叶', '综漫', ['月计', '脑叶', '边狱', '图书馆']],
  ['Re0', '综漫', ['菜月昴', 'RE0', '蕾姆', '艾米莉亚']],
  ['只狼魂系', '综漫', ['只狼', '法环', '魂系', '交界地', '艾尔登']],
  ['高达机甲', '综漫', ['高达', '机甲', '殖民卫星', '机动战士']],
  ['东方幻想', '综漫', ['东方', '幻想乡', '博丽', '魔理沙']],
  ['伊蕾娜', '综漫', ['伊蕾娜', '魔女之旅']],
  ['符咒港漫', '综漫', ['圣主', '十二符咒', '成龙', '刃牙', '烈海王']],
  ['死亡笔记', '综漫', ['死亡笔记', '夜神月', '死神笔记']],
  ['恶魔高校', '综漫', ['恶魔高中', '恶魔高校', '弑神者']],
  ['MC方块', '诸天万界', ['MC', '我的世界', '史蒂夫', '空岛', '植物大战僵尸']],
  ['三角洲', '综漫', ['三角洲', '烽火地带', '摸金撤离']],
  ['LOL电竞', '综漫', ['LOL', 'LPL', '英雄联盟', '电竞', 'chovy', '虎扑', 'S赛']],
  ['东京', '综漫', ['东京', '霓虹', '涩谷', '神社', '平冢静', '新宿']],

  // === 4. 情感 / 病娇 / 反派 / 人设体系 ===
  ['病娇', null, ['病娇', '独占欲', '偏执', '囚禁', '锁死']],
  ['重女压抑', '病娇', ['重女', '压抑', '阴暗', '阴湿', '扭曲', '重力', '胃痛', '病态']],
  ['黑化', '病娇', ['黑化', '坏掉', '黑莲花', '发疯']],
  ['修罗场', '病娇', ['修罗场', '柴刀', '清算', '抓奸', '包围']],
  ['多女主', '病娇', ['多女主', '后宫', '全都要', '红颜', '她们都', '全女', '人尽可妻']],
  ['穿书女频', '病娇', ['穿书', '女频', '原著', '女配', '炮灰', '穿成']],
  ['反派', '病娇', ['反派', '天命反派', '大反派', '黄毛', '恶人', '人渣', '反派头子']],
  ['恶役', '反派', ['恶役', '恶役千金', '恶役少爷', '恶女']],
  ['师尊', '病娇', ['师尊', '逆徒', '冲师', '为师']],
  ['师姐师妹', '师尊', ['师姐', '大师姐', '师妹', '同门']],
  ['仙子', '师尊', ['仙子', '冰山仙子', '清冷仙子']],
  ['女帝女皇', '病娇', ['女帝', '女皇', '皇女', '公主']],
  ['大小姐', '病娇', ['大小姐', '千金', '京圈', '纨绔', '少爷']],
  ['校花学姐', '病娇', ['校花', '学姐', '学妹', '班花', '后桌', '辣妹']],
  ['青梅', '病娇', ['青梅', '青梅竹马', '幼驯染']],
  ['白月光', '病娇', ['白月光', '替身', '朱砂痣', '亡妻']],
  ['代餐攻略', '病娇', ['代餐', '攻略', '好感度', '倒追', '宠妻', '宠爱', '欠爱']],
  ['老婆妻子', '病娇', ['老婆', '妻子', '植物人老婆', '结婚', '婚配']],
  ['女友前任', '病娇', ['女友', '前女友', '前任', '恋人', '租借男友', '牛头人']],
  ['退婚离婚', '病娇', ['退婚', '离婚', '休妻', '未婚妻', '火葬场', '后悔']],
  ['纯爱发糖', '病娇', ['纯爱', '甜文', '单女主', '发糖', '好女孩']],
  ['乐子人', '病娇', ['乐子人', '抽象', '整活', '魔丸', '迫害', '找乐子', '串子', '神人', '嘴臭', '吐槽']],
  ['养成带娃', '病娇', ['养成', '养娃', '带娃', '云养', '带孩子', '捡到', '捡回家', '收留', '妈妈']],
  ['网恋恋综', '病娇', ['网恋', '恋综', '恋爱综艺', '相亲']],
  ['高冷绿茶', '病娇', ['高冷', '冰山', '三无', '傲娇', '绿茶', '白莲', '坏女人', '反差']],
  ['女尊', '病娇', ['女尊', '女多男少', '男尊']],
  ['宿敌宿命', '病娇', ['宿敌', '反杀', '背后灵', '性格反转']],

  // === 5. 魔女 / 变身 / 西幻轻小说体系 ===
  ['魔女', null, ['魔女', '魔女审判', '魔女学院', '魔裁', '魔女小屋']],
  ['魔法少女', '魔女', ['魔法少女', '马猴烧酒']],
  ['魔法', '魔女', ['魔法', '法师', '魔导', '法术', '大魔导']],
  ['西幻', '魔女', ['西幻', '异世界', '异界', '中世纪', '地下城', '冒险者', '剑与魔法', '奇美拉']],
  ['巫师', '西幻', ['巫师', '巫师塔', '魔药', '冥想法']],
  ['领主', '西幻', ['领主', '全民领主', '领地', '庄园', '城堡']],
  ['骑士', '西幻', ['骑士', '圣骑士', '骑士团', '圣殿骑士']],
  ['圣女', '魔女', ['圣女', '教廷', '教会', '神官']],
  ['修女牧师', '圣女', ['修女', '牧师', '神父', '圣职', '巫女']],
  ['勇者', '西幻', ['勇者', '勇者小队']],
  ['魔王魔神', '西幻', ['魔王', '魔神', '魔界', '魔族', '恶龙']],
  ['恶堕战败', '魔女', ['堕落', '恶堕', '战败', '败北', '沦为', '沦陷', '俘虏', '玩物', '催眠', '驯服', '白给', '宠物', '奴隶', '压榨', '拍卖会', '强制']],
  ['变身', null, ['变身', '变百', '变嫁', '娘化', '变为少女', '变成少女']],
  ['性转女装', '变身', ['性转', '女装', '伪娘', '娘化MOD']],
  ['龙娘龙姬', '变身', ['龙娘', '龙姬', '银龙', '白龙', '奶龙', '龙人', '金龙']],
  ['狐娘精灵', '变身', ['狐娘', '精灵', '兽耳', '猫娘', '兔女郎', '魔物娘', '妖女']],
  ['魅魔恶魔', '变身', ['魅魔', '小恶魔', '恶魔']],
  ['吸血姬', '变身', ['吸血姬', '吸血鬼', '血族', '血姬']],
  ['女仆执事', '变身', ['女仆', '侍女', '执事', '仿生女仆']],
  ['天使神明', '魔女', ['天使', '堕天使', '神明', '女神']],
  ['凤傲天', '变身', ['凤傲天', '大女主', '万雌王']],
  ['雌小鬼', '变身', ['雌小鬼', '杂鱼', '萝莉']],
  ['轻百橘味', '变身', ['橘味', '百合', '贴贴', '抱歉女', '小可怜', '软萌', '问题少女']],
  ['哥布林', '西幻', ['哥布林', '史莱姆', '魔物', '地精']],
  ['转生', '变身', ['转生', '转生成', '转世']],
  ['异界学院', '西幻', ['学院', '魔法学院', '龙姬学院', '贵族学院']],

  // === 6. 诡异 / 怪谈 / 末世求生体系 ===
  ['诡异', null, ['诡异', '灵异', '诡秘', '厉鬼', '鬼帝', '女鬼', '伪人', '里世界', '死界']],
  ['规则怪谈', '诡异', ['规则怪谈', '怪谈', '禁忌怪谈']],
  ['中式恐怖', '诡异', ['中式恐怖', '恐怖', '民俗', '纸人', '冥婚', '红衣', '皮嫁骨', '子母桩', '飞僵']],
  ['九叔僵尸', '中式恐怖', ['九叔', '僵尸', '茅山', '道士', '天师', '道长', '请神']],
  ['盗墓', '中式恐怖', ['盗墓', '摸金', '古墓', '下墓']],
  ['克苏鲁', '诡异', ['克苏鲁', '旧日', '神秘学', '外神', '古神', '调查员']],
  ['邪神邪教', '克苏鲁', ['邪神', '邪教', '禁忌灾厄', '污染', '献祭']],
  ['副本', '诡异', ['副本', '地狱副本', '通关', '死亡游戏']],
  ['求生', null, ['求生', '生存指南', '活下去']],
  ['公路列车', '求生', ['公路求生', '序列车队', '列车', '房车', '车队']],
  ['航海求生', '求生', ['航海', '大航海', '海岛', '海洋求生', '船长']],
  ['序列途径', '求生', ['序列', '途径', '奇物']],
  ['国运', '求生', ['国运', '国运禁地', '全球降临', '绑定国家']],
  ['末世废土', '求生', ['末世', '末日', '丧尸', '废土', '避难所', '病毒', '屯物资']],
  ['科幻星际', '末世废土', ['科幻', '星际', '舰队', '虫巢', '太空', '母舰', '仿生']],
  ['赛博朋克', '科幻星际', ['赛博', '2077', '公司狗', '义体', '夜之城']],

  // === 7. 都市 / 华娱 / 历史 / 年代体系 ===
  ['华娱', null, ['华娱', '娱乐圈', '顶流', '影帝', '导演', '拍戏', '女星', '北电', '中戏', '港娱', '偶像', '退圈']],
  ['韩娱半岛', '华娱', ['韩娱', '半岛', '爱豆', '韩国', '女团', '首尔']],
  ['文娱歌手', '华娱', ['歌手', '唱歌', '文豪', '编剧', '曲爹', '影后', '特效']],
  ['重生', null, ['重生', '重回', '重活一世']],
  ['年代', '重生', ['年代', '197', '198', '199', '80年代', '90年代', '四合院', '东北往事', '赶山', '1955']],
  ['美利坚', '年代', ['美利坚', '美国', '纽约', '华尔街', '硅谷', '好莱坞']],
  ['校园', '重生', ['校园', '高中', '大学', '大一', '毕业', '同桌', '状元', '室友']],
  ['日常', '重生', ['日常', '恋爱日常', '轻松日常', '温馨']],
  ['神豪暴富', '重生', ['神豪', '首富', '亿万', '中奖', '一个亿', '暴富', '返利', '还债', '负债']],
  ['搞钱商战', '重生', ['搞钱', '赚钱', '发财', '亏钱', '商战', '创业', '金融', '炒股', '财阀', '贷款']],
  ['躺平摆烂', '重生', ['躺平', '摆烂', '摸鱼', '退休', '咸鱼', '退隐', '颓废']],
  ['职场专业', '日常', ['职场', '律师', '医生', '急诊', '军医', '心理医生', '上司', '总裁', '打工', '编辑', '典狱长', '离职', '手术刀']],
  ['美食种田', '日常', ['美食', '料理', '厨神', '种田', '养鸡', '养猪', '农夫', '牛肉']],
  ['体育竞技', '日常', ['NBA', '篮球', '足球', '网球', '体育', '冠军']],
  ['王朝历史', null, ['王朝', '皇帝', '太子', '权谋', '造反', '乱世', '封王', '路易十六']],
  ['大唐', '王朝历史', ['大唐', '李世民', '贞观', '长安', '盛唐']],
  ['大明', '王朝历史', ['大明', '朱元璋', '洪武', '朱棣', '崇祯', '嘉靖']],
  ['三国大汉', '王朝历史', ['三国', '吕布', '曹操', '刘备', '大汉', '汉武帝', '秦汉']],
  ['清末民国', '王朝历史', ['清末', '民国', '军阀', '晚清', '上海滩']],
  ['红楼港综', '王朝历史', ['红楼', '贾宝玉', '林黛玉', '港综', '香江', '九龙']],
  ['黑道救世', '日常', ['黑道', '帮派', '救世', '救世主', '大佬', '越狱', '暗杀']],
]

export interface KeywordNodeData {
  n: number
  heat: number
  top1: number
  dom: 'fanqie' | 'qidian' | 'ciweimao' | 'sfacg'
  sc: [number, number, number, number]
  ss: [number, number, number, number]
  p: string | null
  sb: string
  r: Array<[string, number, number, string]>
}

export type CloudItemTuple = [term: string, share: number, count: number, top1: number, topBook: string, topVal: number]

export interface KeywordGraphResult {
  ok: true
  meta: {
    totalBooks: number
    days: number
    totalDays: number
    windowDays: number
    termCount: number
    dateRange: string | null
  }
  clouds: {
    fanqie: CloudItemTuple[]
    qidian: CloudItemTuple[]
    ciweimao: CloudItemTuple[]
    sfacg: CloudItemTuple[]
  }
  nodes: Record<string, KeywordNodeData>
}

const KW_CACHE = new Map<string, KeywordGraphResult>()
const KW_SITES = ['fanqie', 'qidian', 'ciweimao', 'sfacg'] as const
type KwSite = (typeof KW_SITES)[number]

export function computeKeywordGraph(
  root: string,
  opts: { days?: number; boards?: string[] | null; customTerms?: Array<{ term: string; parent?: string | null; aliases: string[] }> } = {},
): KeywordGraphResult {
  const allDates = listDataDates(root)
  const rawDays = Number(opts.days ?? 30)
  const windowDays = Number.isFinite(rawDays) && rawDays > 0 ? Math.round(rawDays) : 0
  const useDates = windowDays > 0 ? allDates.slice(-windowDays) : allDates
  const latestDate = useDates[useDates.length - 1]
  const allowedBoards = Array.isArray(opts.boards)
    ? new Set(opts.boards.map((b) => String(b || '').trim()).filter(Boolean))
    : null
  const boardKey = allowedBoards ? [...allowedBoards].sort().join(',') : '*'
  const customKey = opts.customTerms && opts.customTerms.length ? JSON.stringify(opts.customTerms) : ''
  const cacheKey = root + '|' + windowDays + '|' + useDates.length + '|' + (latestDate || '') + '|' + dirStamp(root, latestDate) + '|b:' + boardKey + '|' + customKey

  const cached = KW_CACHE.get(cacheKey)
  if (cached) return cached

  const lexicon: LexiconEntry[] = [...FINE_LEXICON]
  if (opts.customTerms && opts.customTerms.length) {
    const existing = new Set(lexicon.map((x) => x[0]))
    for (const c of opts.customTerms) {
      const t = String(c.term || '').trim()
      const als = Array.isArray(c.aliases) ? c.aliases.map((a) => String(a || '').trim()).filter((a) => a.length >= 2) : []
      if (!t || !als.length || existing.has(t)) continue
      existing.add(t)
      lexicon.push([t, c.parent ? String(c.parent).trim() : null, als])
    }
  }

  const fmap = loadFontMap(root)
  const hasFmap = Object.keys(fmap).length > 0
  const books = new Map<string, { key: string; plat: KwSite; title: string; val: number; desc: string }>()

  for (const day of useDates) {
    const dir = join(root, day)
    let files: string[] = []
    try { files = readdirSync(dir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.json') || f === 'day-index.json' || f === 'scan.json' || f.endsWith('.untrusted.json')) continue
      const plat = siteFromBoardFile(f)
      if (!plat) continue
      const boardId = f.replace(/\.json$/, '')
      if (allowedBoards && !allowedBoards.has(boardId)) continue
      if (isUntrustedSnap(root, day, boardId)) continue
      const snap = readJsonSafe<Snapshot>(join(dir, f))
      if (!snap || !Array.isArray(snap.rows)) continue
      for (const r of snap.rows) {
        let title = String(r.title || '').trim()
        if (plat === 'fanqie' && hasFmap && hasPua(title)) title = decodePua(title, fmap).text
        if (!title || PUA_RE.test(title)) continue
        const ex = (r.extra || {}) as Record<string, unknown>
        const key = plat + '::' + String(r.key || title)
        const val = Number(r.value || ex.collect || ex.collectBase || ex.popularity || 0) || 0
        let desc = typeof ex.desc === 'string' ? ex.desc : ''
        if (plat === 'fanqie' && hasFmap && hasPua(desc)) desc = decodePua(desc, fmap).text
        desc = desc.replace(PUA_GLOBAL_RE, '')
        const prev = books.get(key)
        if (!prev) {
          books.set(key, { key, plat, title, val, desc })
        } else {
          if (val > prev.val) prev.val = val
          if (title.length > prev.title.length && !title.endsWith('...')) prev.title = title
          if (desc.length > prev.desc.length) prev.desc = desc
        }
      }
    }
  }

  // Enrich values from book-page / qidian caches
  const valCaches = readBookValueCaches(root)
  for (const bk of books.values()) {
    const idPart = bk.key.split('::')[1] || ''
    const c = valCaches.get(bk.plat + ':' + idPart) || valCaches.get(idPart)
    if (c && c.collect != null && c.collect > bk.val) bk.val = c.collect
  }

  const bookArr = [...books.values()]
  interface SiteBucket { n: number; score: number; topVal: number; topBook: string; scores: number[] }
  interface TermAcc {
    term: string
    parent: string | null
    books: typeof bookArr
    bySite: Record<KwSite, SiteBucket>
  }

  const termStats = new Map<string, TermAcc>()
  for (const [term, parent] of lexicon) {
    termStats.set(term, {
      term,
      parent,
      books: [],
      bySite: {
        fanqie: { n: 0, score: 0, topVal: 0, topBook: '', scores: [] },
        qidian: { n: 0, score: 0, topVal: 0, topBook: '', scores: [] },
        ciweimao: { n: 0, score: 0, topVal: 0, topBook: '', scores: [] },
        sfacg: { n: 0, score: 0, topVal: 0, topBook: '', scores: [] },
      },
    })
  }

  const bookTerms = new Map<string, string[]>()
  for (const bk of bookArr) {
    // 严格只匹配 title + desc，绝不吃大榜分类名
    const hay = bk.title + ' ' + bk.desc
    const matched: string[] = []
    const w = Math.sqrt(Math.max(100, bk.val))
    for (const [term, _p, aliases] of lexicon) {
      for (const al of aliases) {
        if (hay.includes(al)) {
          matched.push(term)
          const st = termStats.get(term)!
          st.books.push(bk)
          const bs = st.bySite[bk.plat]
          bs.n += 1
          bs.score += w
          bs.scores.push(w)
          if (bk.val >= bs.topVal) {
            bs.topVal = bk.val
            bs.topBook = bk.title
          }
          break
        }
      }
    }
    if (matched.length >= 2) bookTerms.set(bk.key, matched)
  }

  const siteTot: Record<KwSite, number> = { fanqie: 0, qidian: 0, ciweimao: 0, sfacg: 0 }
  for (const st of termStats.values()) {
    for (const s of KW_SITES) siteTot[s] += st.bySite[s].score
  }

  const clouds: KeywordGraphResult['clouds'] = { fanqie: [], qidian: [], ciweimao: [], sfacg: [] }
  for (const s of KW_SITES) {
    const arr: CloudItemTuple[] = []
    for (const st of termStats.values()) {
      const bs = st.bySite[s]
      if (bs.n < 1) continue
      const share = +((bs.score / Math.max(1, siteTot[s])) * 100).toFixed(2)
      let maxW = 0
      for (const sc of bs.scores) if (sc > maxW) maxW = sc
      const top1 = Math.round((maxW / Math.max(1e-6, bs.score)) * 100)
      arr.push([st.term, share, bs.n, top1, bs.topBook, Math.round(bs.topVal)])
    }
    arr.sort((a, b) => b[1] - a[1])
    clouds[s] = arr
  }

  const coMap = new Map<string, { co: number; topBook: string; topVal: number }>()
  for (const bk of bookArr) {
    const ts = bookTerms.get(bk.key)
    if (!ts) continue
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const a = ts[i] < ts[j] ? ts[i] : ts[j]
        const b = ts[i] < ts[j] ? ts[j] : ts[i]
        const k = a + '||' + b
        const prev = coMap.get(k)
        if (!prev) coMap.set(k, { co: 1, topBook: bk.title, topVal: bk.val })
        else {
          prev.co += 1
          if (bk.val > prev.topVal) {
            prev.topVal = bk.val
            prev.topBook = bk.title
          }
        }
      }
    }
  }

  const nodes: Record<string, KeywordNodeData> = {}
  const activeStats = [...termStats.values()].filter((st) => st.books.length >= 1)
  for (const st of activeStats) {
    const n = st.books.length
    const ss: [number, number, number, number] = [
      +((st.bySite.fanqie.score / Math.max(1, siteTot.fanqie)) * 100).toFixed(2),
      +((st.bySite.qidian.score / Math.max(1, siteTot.qidian)) * 100).toFixed(2),
      +((st.bySite.ciweimao.score / Math.max(1, siteTot.ciweimao)) * 100).toFixed(2),
      +((st.bySite.sfacg.score / Math.max(1, siteTot.sfacg)) * 100).toFixed(2),
    ]
    const sc: [number, number, number, number] = [
      st.bySite.fanqie.n,
      st.bySite.qidian.n,
      st.bySite.ciweimao.n,
      st.bySite.sfacg.n,
    ]
    const heat = +(ss[0] + ss[1] + ss[2] + ss[3]).toFixed(2)
    let domIdx = 0
    for (let i = 1; i < 4; i++) if (ss[i] > ss[domIdx]) domIdx = i
    const dom = KW_SITES[domIdx]
    const domBs = st.bySite[dom]
    let maxW = 0
    for (const v of domBs.scores) if (v > maxW) maxW = v
    const top1 = domBs.scores.length ? Math.round((maxW / Math.max(1e-6, domBs.score)) * 100) : 100
    const sb = domBs.topBook || (st.books[0] && st.books[0].title) || ''

    const rels: Array<[string, number, number, string]> = []
    for (const st2 of activeStats) {
      if (st2.term === st.term) continue
      const a = st.term < st2.term ? st.term : st2.term
      const b = st.term < st2.term ? st2.term : st.term
      const pair = coMap.get(a + '||' + b)
      if (!pair) continue
      if (pair.co < 2 && !(n <= 5 && pair.co >= 1)) continue
      const sim = +(pair.co / Math.sqrt(n * st2.books.length)).toFixed(2)
      if (sim < 0.04) continue
      rels.push([st2.term, pair.co, sim, pair.topBook])
    }
    rels.sort((a, b) => b[2] * Math.log2(b[1] + 1.5) - a[2] * Math.log2(a[1] + 1.5))

    nodes[st.term] = { n, heat, top1, dom, sc, ss, p: st.parent, sb, r: rels.slice(0, 8) }
  }

  const res: KeywordGraphResult = {
    ok: true,
    meta: {
      totalBooks: bookArr.length,
      days: useDates.length,
      totalDays: allDates.length,
      windowDays,
      termCount: Object.keys(nodes).length,
      dateRange: useDates.length ? useDates[0] + ' ~ ' + useDates[useDates.length - 1] : null,
    },
    clouds,
    nodes,
  }

  putBoundedCache(KW_CACHE, cacheKey, res, 12)
  return res
}
