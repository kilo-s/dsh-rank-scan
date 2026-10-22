import { createHash } from 'node:crypto'
import type { BoardStatus, Row } from './types.js'
import type { SlimIndex, SlimRow } from './files.js'

/**
 * 逐榜·逐日的状态索引（工作包 A / 2026-10-22）。
 *
 * 为什么需要它：scan.json 是**一次扫描批次**的记录 —— 按站分时后，一天会有 5 次批次，
 * 后一次会把前一次的 boards 整个换掉。于是「A 站失败、B 站成功」之后，A 的失败与原因
 * 从记录里消失，面板只能靠「有快照 ⇒ ok」去猜，五态退化成两态（体检 P1-A）。
 *
 * 口径：**批次记录照旧（scan.json），但「当天每榜最终状态」单独一份 day-index.json**，
 * 只覆盖本次真正跑过的榜，其余榜原样保留；失败与成功各记一条事实。
 */
export interface BoardDayAttempt {
  status: BoardStatus
  reason: string | null
  at: string
  by: 'manual' | 'timer'
  rows: number
}

export interface BoardDaySuccess {
  at: string
  capturedAt: string | null
  contentDate: string | null
  rows: number
}

export interface BoardDayState {
  boardId: string
  /** 展示用状态：当天最近一次尝试非 ok ⇒ 如实报该状态（失败不会被之后的成功站冲掉） */
  status: BoardStatus
  reason: string | null
  /** false = 命中「换榜/疑似未刷新」判据：原始快照保留，但展示/变化/书签自动更新一律不采纳 */
  trusted: boolean
  lastAttempt: BoardDayAttempt
  /** 当天最近一次**可信成功**；当天没成功过就是 null（不继承别的日期） */
  lastSuccess: BoardDaySuccess | null
  /** true = 同一期内容未变化（周期榜的正常形态，不是 stale） */
  samePeriod?: boolean
}

export interface DayIndex {
  dataDate: string
  /** 单调递增；同日每合并一次真实变化 +1（给前端判断「要不要重新取数」） */
  revision: number
  updatedAt: string
  boards: Record<string, BoardDayState>
}

export interface DayUpdate {
  boardId: string
  status: BoardStatus
  reason?: string | null
  rows: number
  /** false ⇒ 内容被拒（stale）；raw 快照仍在盘上 */
  trusted: boolean
  at: string
  by: 'manual' | 'timer'
  capturedAt?: string | null
  contentDate?: string | null
  samePeriod?: boolean
}

export function emptyDayIndex(dataDate: string, at: string): DayIndex {
  return { dataDate, revision: 0, updatedAt: at, boards: {} }
}

/**
 * 按「本次真正跑过的榜」合并当天状态。**只动 updates 里的榜**，其余榜原样保留。
 * 失败不清除当天更早的成功事实（lastSuccess 保留），但展示状态以最近一次尝试为准。
 */
export function mergeDayIndex(prev: DayIndex | null, dataDate: string, updates: DayUpdate[], at: string): DayIndex {
  const base: DayIndex = prev && prev.dataDate === dataDate
    ? { ...prev, boards: { ...prev.boards } }
    : emptyDayIndex(dataDate, at)
  const before = JSON.stringify(base.boards)
  for (const u of updates) {
    const old = base.boards[u.boardId]
    const ok = u.status === 'ok' && u.trusted
    const status: BoardStatus = u.status === 'ok' && !u.trusted ? 'stale' : u.status
    const next: BoardDayState = {
      boardId: u.boardId,
      status,
      reason: u.reason == null ? null : String(u.reason),
      trusted: u.trusted,
      lastAttempt: {
        status: u.status,
        reason: u.reason == null ? null : String(u.reason),
        at: u.at,
        by: u.by,
        rows: u.rows,
      },
      lastSuccess: ok
        ? { at: u.at, capturedAt: u.capturedAt ?? null, contentDate: u.contentDate ?? null, rows: u.rows }
        : (old ? old.lastSuccess : null),
    }
    if (u.samePeriod) next.samePeriod = true
    base.boards[u.boardId] = next
  }
  const changed = JSON.stringify(base.boards) !== before
  base.revision = changed ? (prev && prev.dataDate === dataDate ? (prev.revision || 0) + 1 : 1) : (base.revision || 0)
  base.updatedAt = at
  return base
}

/** 某榜当天状态（没有记录 ⇒ null，调用方自己回退到「看快照存不存在」的老口径） */
export function boardDayState(idx: DayIndex | null, boardId: string): BoardDayState | null {
  return idx && idx.boards ? idx.boards[boardId] || null : null
}

/**
 * 精简索引按日**逐榜合并**：只覆盖本次真跑过、且可信的榜；其它榜保留。
 * 单榜重抓以前会把整份 slim 换成「只有这一榜」⇒ 其它榜的历史消失、回榜被算成新入榜。
 */
export function mergeSlimBoards(
  prev: SlimIndex | null,
  dataDate: string,
  incoming: Record<string, SlimRow[]>,
  drop: string[] = [],
): SlimIndex {
  const boards: Record<string, SlimRow[]> = prev && prev.dataDate === dataDate ? { ...prev.boards } : {}
  for (const [boardId, rows] of Object.entries(incoming)) {
    if (rows && rows.length) boards[boardId] = rows
  }
  for (const boardId of drop) delete boards[boardId]
  return { dataDate, boards }
}

/**
 * 逐榜向上找「上一次可信成功的数据日」：跳过缺日、跳过被拒快照。
 * 缺日不该被当成「第一次采集」（体检 P1-B）；跨过多天时由调用方按基期/期键保护跨期。
 */
export function previousTrustedDate(
  dates: string[],
  date: string,
  get: (d: string) => { rows?: Row[] } | null,
  isUntrusted: (d: string) => boolean,
): string | null {
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i]
    if (d >= date) continue
    if (isUntrusted(d)) continue
    const s = get(d)
    if (s && Array.isArray(s.rows) && s.rows.length) return d
  }
  return null
}

export interface SnapshotStat { boardId: string; size: number; mtimeMs: number }

/**
 * 数据 revision（字符串）：天索引 revision + 当天所有快照文件的大小/修改时间。
 * 任何一条路径（扫描、单榜重抓、补全、手工修数）只要改写了快照，摘要就变 ⇒
 * 前端可以在**同一数据日期**内发现「数据变了，该重取」，不必靠日期变化。
 */
export function revisionDigest(dayRevision: number, stats: SnapshotStat[], untrusted: string[] = []): string {
  const h = createHash('sha1')
  h.update('r' + String(dayRevision))
  for (const s of stats.slice().sort((a, b) => (a.boardId < b.boardId ? -1 : a.boardId > b.boardId ? 1 : 0))) {
    h.update('|' + s.boardId + ':' + s.size + ':' + Math.round(s.mtimeMs))
  }
  for (const b of untrusted.slice().sort()) h.update('|x:' + b)
  return h.digest('hex').slice(0, 12)
}
