import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HistoryEntry } from './diff.js'
import { addDays, parseLocalDate } from './diff.js'
import type { ScanRecord, Snapshot } from './types.js'

export interface SlimRow { key: string; metric: number | null; rank: number | null }
export interface SlimIndex { dataDate: string; boards: Record<string, SlimRow[]> }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * ★ 2026-10-16（审计 P0-2）：一切「用日期拼路径」的入口都必须先过这里。
 * 这些 date 来自 POST body / 面板日期框，不校验时 join(root, '..') 就能删或写到数据根之外
 * （实测 `POST /repair {"mode":"drop","date":".."}` 会 rmSync 掉 ~/.dsh/data，而且是未鉴权可达）。
 * 只接受严格的 YYYY-MM-DD，其余一律抛错 —— 调用方把错误翻成 400。
 */
export function assertDataDate(input: unknown): string {
  const s = String(input ?? '').trim()
  if (!DATE_RE.test(s)) throw new Error('日期必须形如 YYYY-MM-DD：' + JSON.stringify(String(input ?? '')))
  return s
}

/** 数据目录下的数据日期列表（升序） */
export function listDataDates(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && DATE_RE.test(d.name))
    .map((d) => d.name)
    .sort()
}

/** 保留策略 → 该删哪些数据日期 */
export function planCleanup(dates: string[], today: string, keepDays: number | 'forever'): string[] {
  if (keepDays === 'forever') return []
  const t = parseLocalDate(today).getTime()
  const keep = typeof keepDays === 'number' ? keepDays : 180
  return dates.filter((d) => Math.round((t - parseLocalDate(d).getTime()) / 86400000) > keep)
}

export function dirSize(path: string): number {
  if (!existsSync(path)) return 0
  let total = 0
  for (const e of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, e.name)
    if (e.isDirectory()) total += dirSize(p)
    else {
      try { total += statSync(p).size } catch { /* 忽略读不到的文件 */ }
    }
  }
  return total
}

/** 删除指定数据日期目录，返回释放的字节数 */
export function applyCleanup(root: string, dates: string[]): number {
  let freed = 0
  for (const d of dates) {
    const p = join(root, d)
    freed += dirSize(p)
    try { rmSync(p, { recursive: true, force: true }) } catch { /* 单个失败不阻塞其余 */ }
  }
  return freed
}

/**
 * 递归复制目录（逐文件 copyFileSync）。
 * 刻意不用 fs.cpSync({recursive:true})：本地沙箱下递归复制目录实测报 EIO 'Access is denied'，
 * 而逐个文件复制正常（2026-10-14 T12-8 验收实测）。
 */
function copyDirDeep(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name)
    const d = join(dest, e.name)
    if (e.isDirectory()) copyDirDeep(s, d)
    else copyFileSync(s, d)
  }
}

/**
 * 保留策略执行（纯文件操作，可离线单测）：按 keepDays 删掉过期的**数据日期目录**。
 * ★ 只删 `<root>/<YYYY-MM-DD>/`；**绝不触碰 `state/`**（配置、书签、书页缓存都在里面）。
 * 返回被删的日期与释放字节数，供调用方记日志 / 面板展示。
 */
export function runRetention(root: string, today: string, keepDays: number | 'forever'): { removed: string[]; freed: number } {
  if (keepDays === 'forever') return { removed: [], freed: 0 }
  const doomed = planCleanup(listDataDates(root), today, keepDays)
  if (!doomed.length) return { removed: [], freed: 0 }
  return { removed: doomed, freed: applyCleanup(root, doomed) }
}

/**
 * ★ 2026-10-16（使用者提的缺口）：保留策略的**输入规范化**。
 * 面板以前只能显示「保留 N 天」，改不了；现在可选 7–3650 天或永久（'forever'）。
 * 返回 null 表示输入非法（调用方回 400）。
 */
export function normalizeRetention(input: unknown): number | 'forever' | null {
  if (typeof input === 'string' && ['forever', '永久', 'forever ', 'FOREVER'].includes(input.trim())) return 'forever'
  if (input === 'forever') return 'forever'
  const n = Number(input)
  if (!Number.isFinite(n)) return null
  const d = Math.round(n)
  if (d < 7 || d > 3650) return null
  return d
}

/** 导出：把 [from, to] 区间的快照与报告复制到目标目录（不含 state/，凭证不在数据目录） */
export function exportRange(root: string, from: string, to: string, destDir: string): string[] {
  const out: string[] = []
  mkdirSync(destDir, { recursive: true })
  for (const d of listDataDates(root)) {
    if (d < from || d > to) continue
    const src = join(root, d)
    const dest = join(destDir, d)
    copyDirDeep(src, dest)
    for (const f of readdirSync(dest)) out.push(d + '/' + f)
  }
  const reports = join(root, 'reports')
  if (existsSync(reports)) {
    for (const f of readdirSync(reports)) {
      const day = f.replace(/\.md$/, '')
      if (day < from || day > to) continue
      mkdirSync(join(destDir, 'reports'), { recursive: true })
      copyFileSync(join(reports, f), join(destDir, 'reports', f))
      out.push('reports/' + f)
    }
  }
  return out
}

export function writeSlim(root: string, s: SlimIndex): string {
  const dir = join(root, 'slim')
  mkdirSync(dir, { recursive: true })
  const p = join(dir, s.dataDate + '.json')
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', 'utf8')
  // ★ 审计-2/39：旧实现「先 rm 再 copy」——两步之间进程被杀会**直接丢掉主文件**（面板该栏显示缺数据），
  //   而同一仓库的 store 与书签都用 renameSync（Windows 上按 REPLACE_EXISTING 覆盖）。这里统一。
  renameSync(tmp, p)
  return p
}

export function readSlim(root: string, dataDate: string): SlimIndex | null {
  try { return JSON.parse(readFileSync(join(root, 'slim', dataDate + '.json'), 'utf8')) as SlimIndex } catch { return null }
}

export function listSlim(root: string): string[] {
  const dir = join(root, 'slim')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => DATE_RE.test(f.replace(/\.json$/, ''))).map((f) => f.replace(/\.json$/, '')).sort()
}

export function writeReport(root: string, dataDate: string, md: string): string {
  const dir = join(root, 'reports')
  mkdirSync(dir, { recursive: true })
  const p = join(dir, dataDate + '.md')
  writeFileSync(p, md, 'utf8')
  return p
}

/** 从扫描记录 + 当天快照抽精简索引（书号 / 指标 / 名次） */
export function buildSlim(record: ScanRecord, snapshots: Map<string, Snapshot>): SlimIndex {
  const boards: Record<string, SlimRow[]> = {}
  for (const b of record.boards) {
    if (b.status !== 'ok' || !b.rows.length) continue
    const snap = snapshots.get(b.boardId)
    const rows = snap && snap.rows.length ? snap.rows : b.rows
    boards[b.boardId] = rows.map((r) => ({ key: r.key, rank: r.rank, metric: r.value }))
  }
  return { dataDate: record.dataDate, boards }
}

/** 某榜历史（默认取今天之前的全部精简索引） */
export function historyFor(indexes: SlimIndex[], boardId: string, beforeDate: string): Map<string, HistoryEntry> {
  const m = new Map<string, HistoryEntry>()
  for (const idx of indexes) {
    if (idx.dataDate >= beforeDate) continue
    const rows = idx.boards[boardId]
    if (!rows) continue
    for (const r of rows) {
      const e = m.get(r.key) || { lastDate: idx.dataDate, dates: [] }
      e.dates.push(idx.dataDate)
      if (idx.dataDate > e.lastDate) e.lastDate = idx.dataDate
      m.set(r.key, e)
    }
  }
  return m
}

/** 上一次可用快照的数据日期（今天之前最近的一天） */
export function previousDataDate(dates: string[], today: string): string | null {
  const before = dates.filter((d) => d < today)
  return before.length ? before[before.length - 1] : null
}

/**
 * ★ 审计-2/39：清扫原子写中途留下的 `*.tmp`（旧实现只写不扫，数据目录里永久堆积）。
 * 只删 `<root>` 下深度受限的 `.tmp` 文件；删不掉不影响启动。
 */
export function sweepTmp(root: string, maxDepth = 3): number {
  let n = 0
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let entries: any[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.name.endsWith('.tmp')) { try { rmSync(p, { force: true }); n += 1 } catch { /* 忽略 */ } }
    }
  }
  walk(root, 0)
  return n
}

export { addDays }
