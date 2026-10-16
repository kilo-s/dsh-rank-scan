import type { Metric, Row, Snapshot } from './types.js'

/** 变化集条目 */
export interface DiffEntry {
  key: string
  title: string
  author: string | null
  url: string | null
  rank: number | null
  prevRank: number | null
  /** 名次型：prevRank - rank（正=上升）；数值型：value - valuePrev */
  delta: number | null
  /** 连续在榜天数（断档归零） */
  days: number
}

export interface MetricDelta {
  key: string
  title: string
  delta: number
  value: number
}

export interface BoardDiff {
  boardId: string
  metric: Metric
  /** 对比基准日；null = 无基准 */
  baselineDate: string | null
  firstEver: boolean
  newEntry: DiffEntry[]
  rebound: DiffEntry[]
  up: DiffEntry[]
  down: DiffEntry[]
  flat: DiffEntry[]
  out: DiffEntry[]
  metricDelta: MetricDelta[]
  /** ★ 2026-10-16：基准日与本次不属于同一期 ⇒ 该榜的数值/名次变化不可比（调用方须置空变化列） */
  crossPeriod?: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

export function parseLocalDate(s: string): Date {
  const parts = s.split('-').map(Number)
  return new Date(parts[0], parts[1] - 1, parts[2])
}

export function addDays(s: string, n: number): string {
  const d = parseLocalDate(s)
  d.setDate(d.getDate() + n)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/** 某个日期所在「周」的期首日 = 本地**本周日**（起点图三江口径，URL 形如 bang/1/6 加期首日，每周日滚一期） */
export function sundayOf(date: string): string {
  const d = parseLocalDate(date)
  d.setDate(d.getDate() - d.getDay()) // 0=周日 ⇒ 减到本周日
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/**
 * ★ 跨期不可比保护（2026-10-16，收尾缺口 #2）。
 *
 * 为什么要有它：变化列一律拿「上一数据日」当基准，而**周期榜换期当天**上一数据日属于
 * **上一期**：两边的数值根本不是同一件事（三江是「本期的收藏增量」，刺猬猫首订(约)是
 * 「上一期的名次」）⇒ 直接相减（或相减名次）会报出一个**看起来真实、其实毫无意义**的变化。
 *
 * 口径（与使用者 2026-10-16 的「显示『新期』/空」一致）：
 *   - 只有**周期榜**需要保护（按 boardId 显式列出；番茄在读周榜由 derive.ts 自己保证期内口径）；
 *   - periodKeyOf 由调用方注入（刺猬猫的「期」= 第三方接口的 issue 号，只有调用方拿得到快照）；
 *   - 没给 periodKeyOf 的周期榜用**本周日**当期键（三江）。
 * 返回可比性判定：crossed = true ⇒ 调用方必须把该榜的变化列判为「不可比」（置空 / 显示「新期」）。
 */
export function guardCrossPeriod(input: {
  boardId: string
  /** 上一数据日 */
  prevDate: string | null
  /** 本次数据日 */
  date: string
  /** 期键：同值 = 同一期；返回 null/undefined = 该侧推不出期（退化成「不可比」） */
  periodKeyOf?: (date: string) => string | null | undefined
}): { periodic: boolean; crossed: boolean; comparable: boolean; prevPeriod: string | null; curPeriod: string | null } {
  const periodic = input.boardId === 'qidiantu.sanjiang' || input.boardId === 'ciweimao.buy.latest'
  const keyOf = (d: string): string | null => {
    const k = input.periodKeyOf ? input.periodKeyOf(d) : sundayOf(d)
    return k == null ? null : String(k)
  }
  const prevPeriod = input.prevDate ? keyOf(input.prevDate) : null
  const curPeriod = keyOf(input.date)
  // 只有「有上一数据日」且**期键不同**才算跨期；任一侧推不出期 ⇒ 保守判不可比
  const crossed = periodic && !!input.prevDate && (prevPeriod == null || curPeriod == null || prevPeriod !== curPeriod)
  return { periodic, crossed, comparable: !crossed, prevPeriod, curPeriod }
}

/** 历史：某书号在哪些数据日期出现过（不含今天也行） */
export interface HistoryEntry { lastDate: string; dates: string[] }

/** 连续在榜天数：从今天往回数，断档归零 */
export function daysOnBoard(key: string, dataDate: string, history?: Map<string, HistoryEntry>): number {
  const dates = new Set((history && history.get(key) ? history.get(key)!.dates : []) || [])
  let n = 1
  let cur = addDays(dataDate, -1)
  while (dates.has(cur)) {
    n += 1
    cur = addDays(cur, -1)
  }
  return n
}

function entry(r: Row, prevRank: number | null, delta: number | null, days: number): DiffEntry {
  return {
    key: r.key,
    title: r.title,
    author: r.author,
    url: r.url,
    rank: r.rank,
    prevRank,
    delta,
    days,
  }
}

/**
 * 变化集：本次 vs 上一次成功扫描。
 * - 新入榜 = 历史第一次出现；回榜 = 历史出现过、上次不在、这次回来（分开计数）
 * - 名次型：|Δ| ≤ jitter（默认 2，并列抖动）算作持平，不计入上升/下降
 * - 无基准（没有更早的快照）⇒ firstEver = true，各类均为空（不报 0）
 */
export function computeBoardDiff(input: {
  boardId: string
  metric: Metric
  current: Snapshot
  previous: Snapshot | null
  history?: Map<string, HistoryEntry>
  jitter?: number
  /**
   * ★ 2026-10-16：周期榜的**期键**（同值 = 同一期）。给了就启用「跨期不可比保护」；
   *   不给则用本周日当默认期键（三江口径）。详见 guardCrossPeriod。
   */
  periodKeyOf?: (date: string) => string | null | undefined
}): BoardDiff {
  const { boardId, metric, current, previous, history } = input
  const jitter = typeof input.jitter === 'number' ? input.jitter : 2
  const base: BoardDiff = {
    boardId,
    metric,
    baselineDate: previous ? previous.dataDate : null,
    firstEver: !previous,
    newEntry: [],
    rebound: [],
    up: [],
    down: [],
    flat: [],
    out: [],
    metricDelta: [],
  }
  if (!previous) return base

  /**
   * ★ 跨期不可比保护（2026-10-16）：基准日与本次不属于同一期 ⇒ **变化列一律置空**。
   *   只对周期榜生效（guardCrossPeriod 里的显式清单）；非周期榜 crossed 恒 false，行为不变。
   */
  const guard = guardCrossPeriod({ boardId, prevDate: previous.dataDate, date: current.dataDate, periodKeyOf: input.periodKeyOf })
  if (guard.crossed) base.crossPeriod = true

  const prevRows = new Map<string, Row>()
  for (const r of previous.rows) prevRows.set(r.key, r)
  const curKeys = new Set<string>()

  for (const r of current.rows) {
    curKeys.add(r.key)
    const prev = prevRows.get(r.key)
    const days = daysOnBoard(r.key, current.dataDate, history)
    if (!prev) {
      const seen = !!(history && history.get(r.key))
      const e = entry(r, null, null, days)
      if (seen) base.rebound.push(e)
      else base.newEntry.push(e)
      continue
    }
    if (metric === 'rank') {
      const pr = prev.rank
      const cr = r.rank
      const raw = pr != null && cr != null ? pr - cr : null
      // 跨期：名次是「上一期那一榜上的位置」，与本期不可比 ⇒ 置空（分组按持平，不报假升降）
      const delta = guard.crossed ? null : raw
      const e = entry(r, pr, delta, days)
      if (delta == null || Math.abs(delta) <= jitter) base.flat.push(e)
      else if (delta > 0) base.up.push(e)
      else base.down.push(e)
    } else {
      const pv = prev.value
      const cv = r.value
      const raw = pv != null && cv != null ? cv - pv : null
      const delta = guard.crossed ? null : raw
      const e = entry(r, null, delta, days)
      if (delta == null || delta === 0) base.flat.push(e)
      else if (delta > 0) base.up.push(e)
      else base.down.push(e)
      if (delta != null && delta !== 0) base.metricDelta.push({ key: r.key, title: r.title, delta, value: cv == null ? 0 : cv })
    }
  }

  for (const r of previous.rows) {
    if (curKeys.has(r.key)) continue
    base.out.push(entry(r, r.rank, null, daysOnBoard(r.key, current.dataDate, history)))
  }

  const byDelta = (a: DiffEntry, b: DiffEntry) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0)
  base.up.sort(byDelta)
  base.down.sort(byDelta)
  base.metricDelta.sort((a, b) => b.delta - a.delta)
  return base
}
