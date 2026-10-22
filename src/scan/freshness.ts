import type { Row } from './types.js'

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
