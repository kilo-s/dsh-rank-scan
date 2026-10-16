import type { Row } from './types.js'
import { addDays } from './diff.js'
import { withFanqieCat } from './view.js'

/**
 * 番茄派生榜（2026-10-15 使用者定稿，**自然周口径**）—— 全部由已落盘快照算出，**不发任何请求**。
 *
 * 为什么是「自然周」而不是「最近 7 个数据日」：
 *   - 滚动窗口下每本书的基准是它**自己** 7 天前那条 ⇒ 入池 3 天的书只有 3 天涨幅，
 *     却要和入池 5 年的书同榜比，**横向不可比**；
 *   - 「从入池起累加每日涨幅」在数学上恒等于「今天的在读数」，等于没做统计（使用者 2026-10-15 指出）；
 *   - 因此照搬起点图三江榜的口径：**同一期首日 + 期内累加每日增量 + 已结算 N 天**，
 *     全站共用同一个基准日，N 本书才可比。
 *
 * 周期 = 自然周（周一~周日）。期首冻结基准读数，期内只累加每日增量（日粒度，怕丢一天数据）。
 * 榜单默认按**今日涨幅**倒序（使用者 2026-10-15），另提供「本周累计涨幅」倒序排序项。
 */
export interface SnapshotLike { boardId: string; dataDate: string; metric: string; rows: Row[] }

export type SnapshotReader = (boardId: string, date: string) => SnapshotLike | null

export interface DerivedView {
  boardId: string
  title: string
  rows: Row[]
  /** 参与计算的数据日期（升序，落在本期内的） */
  dates: string[]
  windowStart: string | null
  periodStart: string
  periodEnd: string
  periodIndex: number
  settledDays: number
  /** 应已过天数（周一=1 … 周日=7），用于暴露「有几天没抓到」 */
  elapsed: number
  /** 实际有数据的日期（MM-DD，顿号分隔），写进说明让人一眼看懂缺口 */
  datesLabel: string
  note: string | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const DAY = 86400000
const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (t: number) => {
  const d = new Date(t)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
/** 本周周一（本地时区），自然周口径的期首 */
export function weekStart(date: string): string {
  const p = date.split('-').map(Number)
  const d = new Date(p[0], p[1] - 1, p[2])
  const dow = (d.getDay() + 6) % 7 // 周一=0 … 周日=6
  d.setDate(d.getDate() - dow)
  return fmt(d.getTime())
}

export function deriveFanqieViews(
  read: SnapshotReader,
  opts: { date: string; poolBoards: string[]; dataDates: string[] },
): DerivedView[] {
  /**
   * ★ 读取去重（2026-10-16 使用者反馈「切换番茄周榜加载半天」）：
   *   valueAt / daysInPool / pdaysOf 的访问模式是「每本书 × 每个日期 × 池内每个榜」，
   *   而同一轮派生里快照不会变。实测 /board?boardId=fanqie.derived.period 触发
   *   **18,639 次 readSnapshot / 读 130MB / 4.6 秒**（池子只有 8 个榜 × 6 个日期 ⇒ 应有 ≤48 次读）。
   *   这里按 (日期, 榜) 缓存，数值与对外行为完全不变。
   */
  const cache = new Map<string, SnapshotLike | null>()
  const readOnce: SnapshotReader = (b, d) => {
    const k = d + '|' + b
    if (!cache.has(k)) cache.set(k, read(b, d))
    return cache.get(k) as SnapshotLike | null
  }
  const today = opts.date
  const periodStart = weekStart(today)
  const periodEnd = addDays(periodStart, 6)
  // 本期内的数据日期（升序）：>= 期首 且 <= 今天
  const dates = opts.dataDates.filter((d) => d >= periodStart && d <= today).sort()
  const settledDays = dates.length
  // 「应已过天数」= 期首到今天的天数（含今天）：周一=1、周四=4。用来提示「有几天本地没有快照」
  const elapsed = Math.max(1, Math.round((Date.parse(today + 'T00:00:00') - Date.parse(periodStart + 'T00:00:00')) / DAY) + 1)
  const prevDate = dates.filter((d) => d < today).slice(-1)[0] || null
  // 池子：今日各榜并集（同一本书取第一条书名看起来干净的那条）
  const pool = new Map<string, Row>()
  // 顺手收集每本书的**字数/分类**（番茄快照 extra 里有 wordNumber / catId）——
  // 使用者 2026-10-15：在读周榜也要显示作品字数，此前因为派生行没带这两个字段而整列空着。
  const meta = new Map<string, { words: number | null; catId: number | null }>()
  for (const b of opts.poolBoards) {
    const s = readOnce(b, today)
    if (!s) continue
    for (const r of s.rows) {
      const cur = pool.get(r.key)
      if (!cur) pool.set(r.key, r)
      else if (!cur.title && r.title) pool.set(r.key, r)
      const ex: any = (r as any).extra || {}
      const prev = meta.get(r.key)
      const words = typeof ex.wordNumber === 'number' && Number.isFinite(ex.wordNumber) ? ex.wordNumber : null
      const catId = typeof ex.catId === 'number' ? ex.catId : null
      if (!prev) meta.set(r.key, { words, catId })
      else meta.set(r.key, { words: prev.words != null ? prev.words : words, catId: prev.catId != null ? prev.catId : catId })
    }
  }
  const valueAt = (key: string, date: string): number | null => {
    for (const b of opts.poolBoards) {
      const s = readOnce(b, date)
      if (!s) continue
      const hit = s.rows.find((r) => r.key === key)
      if (hit) return num(hit.value)
    }
    return null
  }
  const inPoolAt = (key: string, date: string): boolean => valueAt(key, date) != null
  const daysInPool = (key: string): number => dates.filter((d) => inPoolAt(key, d)).length

  /**
   * ★ 本期 7 天的逐日增量（使用者 2026-10-15：番茄周榜要像起点图三江那样「每天统计变化」）。
   *   第 N 天 = 第 N 天在读 − 第 N−1 天在读；缺任一侧 ⇒ null（不伪造 0）。
   *   注意第 1 天的前一天在**期外**，所以第 1 天恒为 null——期首是基准，不是「第 1 天的涨幅」。
   */
  const periodDays: string[] = []
  for (let i = 0; i < 7; i++) periodDays.push(addDays(periodStart, i))
  const pdaysOf = (key: string): (number | null)[] => {
    const vals = periodDays.map((d) => (d > today ? null : valueAt(key, d)))
    return periodDays.map((d, i) => {
      if (d > today) return null
      const cur = vals[i]
      const prev = i === 0 ? null : vals[i - 1]
      return cur != null && prev != null ? cur - prev : null
    })
  }

  const rows: Row[] = []
  for (const [key, r] of pool) {
    const v = num(r.value)                                   // 今日在读
    const pv = prevDate ? valueAt(key, prevDate) : null      // 上一数据日在读
    const gain = v != null && pv != null ? v - pv : null     // 今日涨幅
    /**
     * 本期累计 = 今日在读 − **基准日**在读。
     * ★ 基准日优先期首（周一）；**期首缺快照**时退回「本期内最早有数据的日期」（使用者 2026-10-15）：
     *   我们是从 10-14 才开始抓的，本期 10-12/10-13 根本没有快照 —— 硬拿期首当基准会让
     *   **整榜 240 行全是「—」**，一点用都没有。退回最早数据日后至少给得出「这些天涨了多少」，
     *   代价是基准被推后了，所以界面上必须**标明基准日**（baseDate 一起回传）。
     * 只有「本期内只有今天一天数据」时才真的算不出来 ⇒ null（不伪造 0）。
     */
    const baseDate = valueAt(key, periodStart) != null ? periodStart : (dates.find((d) => d < today && valueAt(key, d) != null) || null)
    const bv = baseDate ? valueAt(key, baseDate) : null
    const periodDelta = v != null && bv != null ? v - bv : null
    rows.push({
      key,
      rank: null,                                            // 下面按今日涨幅赋名次
      value: gain,
      title: r.title,
      author: r.author,
      url: r.url,
      // withFanqieCat：把 extra.catId 解析成 extra.cat（否则「分类」列永远显示「—」）
      extra: withFanqieCat({
        read: v,
        prevRead: pv,
        gain,
        periodDelta,
        baseRead: bv,
        baseDate,
        baseIsPeriodStart: baseDate === periodStart,
        periodStart,
        periodEnd,
        settledDays,
        pdays: pdaysOf(key),
        // 字数/分类（来自所选分类榜的快照；缺失就不写，让列显示「—」）
        ...(meta.get(key) && meta.get(key)!.words != null ? { words: meta.get(key)!.words } : {}),
        ...(meta.get(key) && meta.get(key)!.catId != null ? { catId: meta.get(key)!.catId } : {}),
        inPoolDays: daysInPool(key),
        firstInPool: pv == null,
        caliber: '自然周 ' + periodStart + ' ~ ' + periodEnd + '（已结算 ' + settledDays + '/7 天）',
      }),
    })
  }
  // 默认名次 = 今日涨幅倒序（使用者 2026-10-15 定的默认口径）
  rows.sort((a, b) => (num(b.value) ?? -Infinity) - (num(a.value) ?? -Infinity))
  rows.forEach((r, i) => { r.rank = i + 1 })

  /**
   * 说明里**必须列出实际有数据的那几天**（使用者 2026-10-15 的疑问）：
   * 今天是周四，但本地只有 10-14、10-15 两份快照 ⇒ 已结算 2 天而不是 3 天。
   * 只写「2/7 天」会让人以为算错了（以为漏算一天），把具体日期列出来就一眼明白缺口在哪。
   */
  const datesLabel = dates.map((d) => d.slice(5)).join('、')
  // 说明里写**具体日期范围**（使用者 2026-10-15：不要「周一~周日」这种相对说法）
  const range = periodStart + ' ~ ' + periodEnd
  const coverage = dates.length
    ? '本期 ' + range + '：已结算 ' + settledDays + '/7 天（有数据的日期：' + datesLabel + '）'
    : '本期 ' + range + '：还没有任何数据快照'
  // 期首缺快照 ⇒ 累积基准被推后，必须在说明里点出来（否则「期累计」看着像整周，实际不是）
  const baseDate = dates[0] || null
  const baseNote = baseDate && baseDate !== periodStart
    ? '。⚠ 期首 ' + periodStart + ' 没有快照，「期累计」按本期内最早有数据的 ' + baseDate + ' 起算'
    : ''
  const note = (settledDays < 7 && settledDays < elapsed
    ? coverage + '。⚠ 应已过 ' + elapsed + ' 天，缺的那几天本地没有快照（不算结算）'
    : coverage) + baseNote
  return [{
    boardId: 'fanqie.derived.period',
    title: '在读周榜（候选池内 · 自然周）',
    rows,
    dates,
    windowStart: periodStart,
    periodStart,
    periodEnd,
    periodIndex: 0,
    settledDays,
    elapsed,
    datesLabel,
    note,
  }]
}

