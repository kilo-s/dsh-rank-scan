import type { Row } from './types.js'
import { looksSwapped } from './judges.js'

/**
 * 新鲜度判据（工作包 A / 2026-10-22）。
 *
 * 旧判据：与「上一数据日」逐条 key=value 相同 ⇒ suspected。两个后果（体检 P2-B）：
 *   ① 名次型榜的 value 恒为 null ⇒ 签名退化成 key 列表，细节数字（收藏/字数）不参与；
 *   ② 周期榜同一期内容本来就不变（刺猬猫首订约 issue 478 连两天）⇒ 被判「未刷新」，
 *      进而触发**整站**兜底补抓。10-20/10-21 就这样白跑了两次整站。
 *
 * 新判据：先看榜的更新节奏 —— 周期榜同一期未变化是正常形态（ok / samePeriod）；
 * 只有「每日应刷新的榜」或「已经换期」时，逐条相同才算 suspected。
 * 内容签名纳入名次/数值/收藏/字数/评分，避免名次榜因 value=null 而整榜同签名。
 */

export type BoardCadence = 'daily' | 'weekly' | 'periodic'

/** 该榜的更新节奏：周榜/期榜不变是正常；日榜不变才可疑 */
export function cadenceOfBoard(boardId: string): BoardCadence {
  if (boardId === 'qidiantu.sanjiang') return 'periodic'
  if (boardId === 'ciweimao.buy.latest') return 'periodic'
  if (boardId === 'sfacg.hot.week' || boardId === 'sfacg.vip.week') return 'weekly'
  if (boardId === 'ciweimao.no-vip-click.week' || boardId === 'ciweimao.yp_new.week') return 'weekly'
  return 'daily'
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 本周日（三江/自然周口径；本地自然日解析，忌 toISOString） */
export function weekKeyOf(date: string): string {
  const parts = String(date).split('-').map(Number)
  const d = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1)
  d.setDate(d.getDate() - d.getDay())
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/** 快照行里能拿到的**真实期键**：三江 = 期首日，刺猬猫首订(约) = issue 号 */
export function periodKeyFromRows(rows: Row[] | null | undefined): string | null {
  for (const r of rows || []) {
    const ex = (r && r.extra) || {}
    const v = (ex as Record<string, unknown>).periodStart
    if (v != null && String(v)) return String(v)
  }
  for (const r of rows || []) {
    const ex = (r && r.extra) || {}
    const v = (ex as Record<string, unknown>).issue
    if (v != null && String(v)) {
      const n = Number(v)
      return Number.isFinite(n) ? String(n) : String(v)
    }
  }
  return null
}

const num = (v: unknown): string => (v == null ? '' : String(v))

/** 内容签名：名次/主指标 + 常见细节数字（有就纳入，没有就留空） */
export function contentSignature(rows: Row[] | null | undefined): string {
  return (rows || []).map((r) => {
    const ex = (r && (r.extra as Record<string, unknown>)) || {}
    const words = ex.wordsCnt != null ? ex.wordsCnt : ex.words
    return [String(r.key), num(r.rank), num(r.value), num(ex.collect), num(words), num(ex.score)].join(':')
  }).join('|')
}

export interface FreshnessInput {
  boardId: string
  /** 当前数据日期 */
  date: string
  /** 上一次**可信成功**快照的数据日期 */
  prevDate: string | null
  currentRows: Row[]
  previousRows: Row[] | null
  /** 真实期键（行里取得到就传；取不到留空） */
  currentPeriodKey?: string | null
  previousPeriodKey?: string | null
}

export interface FreshnessVerdict {
  verdict: 'ok' | 'suspected'
  reason: string | null
  /** 同一期未变化（周期榜的正常形态；不是 stale） */
  samePeriod: boolean
  identical: boolean
}

export function judgeFreshness(i: FreshnessInput): FreshnessVerdict {
  const prev = i.previousRows
  if (!prev || !prev.length || !(i.currentRows || []).length) {
    return { verdict: 'ok', reason: null, samePeriod: false, identical: false }
  }
  const identical = contentSignature(i.currentRows) === contentSignature(prev)
  if (!identical) return { verdict: 'ok', reason: null, samePeriod: false, identical: false }
  const cadence = cadenceOfBoard(i.boardId)
  let samePeriod = false
  if (cadence !== 'daily') {
    const curKey = i.currentPeriodKey || (cadence === 'weekly' && i.date ? weekKeyOf(i.date) : null)
    const prevKey = i.previousPeriodKey || (cadence === 'weekly' && i.prevDate ? weekKeyOf(i.prevDate) : null)
    samePeriod = !!curKey && !!prevKey && curKey === prevKey
  }
  if (samePeriod) return { verdict: 'ok', reason: '同一期未变化（正常）', samePeriod: true, identical: true }
  return { verdict: 'suspected', reason: '与上次有效快照逐条相同，且本期应已刷新', samePeriod: false, identical: true }
}

/**
 * ★ 2026-10-25（换期 ≠ 换榜/降级）：原先「与上次有效快照交集 ≤2 ⇒ 换榜」的判据**不认期**，
 *   而刺猬猫「首订（约）」每周整批换新（17 换 17、交集 0）⇒ 每次换期都被判成换榜/降级，
 *   快照被隔离（stale）。更糟的是基准只取「上次可信」，被隔离那天永远不进基准 ⇒
 *   换期后每天仍拿新期跟旧期比、每天都判一次，**永不自愈**（2026-10-24 起实测锁死）。
 *
 * 新口径：只有「同一批次内」才存在换榜/降级这回事。
 *   - 两边都有真实期键（刺猬猫 issue / 三江 periodStart）⇒ 期号相同才算同期；
 *   - 周榜（无行内期键）⇒ 用本地周键 weekKeyOf 判期；
 *   - 日更榜（无周期概念）⇒ 视为同期，保留原有判据；
 *   - 期榜但两边都推不出期号 ⇒ 不下结论（null），宁可漏报也不误锁。
 */
export interface SwapInput {
  boardId: string
  /** 当前数据日期 */
  date: string
  /** 上一次**可信**快照的数据日期 */
  prevDate: string | null
  currentRows: Row[] | null | undefined
  previousRows: Row[] | null | undefined
  /** 交集阈值（默认 2，刺猬猫判据） */
  threshold?: number
}

export interface SwapVerdict {
  /** true = 同一期内与上次几乎无交集 ⇒ 判定换榜/降级 */
  swapped: boolean
  /** true = 同期；false = 跨期（正常批次更替）；null = 推不出期 */
  samePeriod: boolean | null
  /** 给记录/面板看的一句说明（不 swapped 时也可能有值：跨期换批） */
  reason: string | null
}

export function judgeSwap(i: SwapInput): SwapVerdict {
  const cur = i.currentRows || []
  const prev = i.previousRows || []
  if (!cur.length || !prev.length) return { swapped: false, samePeriod: null, reason: null }
  const cadence = cadenceOfBoard(i.boardId)
  const curKey = periodKeyFromRows(cur)
  const prevKey = periodKeyFromRows(prev)
  let samePeriod: boolean | null = null
  if (curKey && prevKey) samePeriod = curKey === prevKey
  else if (cadence === 'weekly' && i.date && i.prevDate) samePeriod = weekKeyOf(i.date) === weekKeyOf(i.prevDate)
  else if (cadence === 'daily') samePeriod = true
  if (samePeriod === false) {
    return { swapped: false, samePeriod: false, reason: '跨期换批（正常形态，不判换榜）' }
  }
  if (samePeriod === null) {
    // 期榜但推不出期号：不下结论。误锁的代价（整榜长期不可见）远大于漏报一次换榜。
    return { swapped: false, samePeriod: null, reason: '推不出期号，跳过换榜判据（避免误锁）' }
  }
  const threshold = typeof i.threshold === 'number' ? i.threshold : 2
  return { swapped: looksSwapped(cur, prev, threshold), samePeriod: true, reason: null }
}
