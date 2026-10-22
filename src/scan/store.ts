import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ScanRecord, Snapshot } from './types.js'
import type { LockInfo, ScanStore } from './run.js'
import type { DayIndex, SnapshotStat } from './daily.js'

/** 内存 store：测试与干跑用 */
export class MemoryStore implements ScanStore {
  snapshots = new Map<string, Snapshot>()
  scans: ScanRecord[] = []
  cancel = false
  retries = new Map<string, number>()
  lock: LockInfo | null = null
  async acquireLock(info: LockInfo, staleMs: number) {
    if (!this.lock) { this.lock = info; return { ok: true, previous: null } }
    // ★ 审计-2/42：心跳不可解析（NaN）时旧比较恒为 false ⇒ 锁永不接管、扫描永久卡住
    const at = Date.parse(this.lock.heartbeatAt)
    const stale = !Number.isFinite(at) ? true : Date.now() - at > staleMs
    if (!stale) return { ok: false, previous: this.lock }
    const previous = this.lock
    this.lock = info
    return { ok: true, previous }
  }
  async heartbeatLock(at: string) { if (this.lock) this.lock.heartbeatAt = at }
  async releaseLock() { this.lock = null }
  async getCancelFlag() { return this.cancel }
  async setCancelFlag(v: boolean) { this.cancel = v }
  async writeSnapshot(s: Snapshot) { this.snapshots.set(s.boardId + '@' + s.dataDate, s) }
  async writeScan(r: ScanRecord) { this.scans.push(r) }
  async readScan(dataDate: string) { return this.scans.filter((s) => s.dataDate === dataDate).slice(-1)[0] || null }
  async getRetryCount(boardId: string, dataDate: string) { return this.retries.get(boardId + '@' + dataDate) || 0 }
  async bumpRetryCount(boardId: string, dataDate: string) {
    const k = boardId + '@' + dataDate
    this.retries.set(k, (this.retries.get(k) || 0) + 1)
  }
  snapshot(boardId: string, dataDate: string) { return this.snapshots.get(boardId + '@' + dataDate) || null }
  snapshotMtime(boardId: string, dataDate: string) { return this.snapshots.has(boardId + '@' + dataDate) ? Date.now() : null }
  /** ★ 工作包 A：逐榜·逐日状态索引（内存实现，测试用） */
  dayIndexes = new Map<string, DayIndex>()
  untrustedKeys = new Set<string>()
  readDayIndex(dataDate: string) { return this.dayIndexes.get(dataDate) || null }
  async writeDayIndex(idx: DayIndex) { this.dayIndexes.set(idx.dataDate, idx) }
  isUntrusted(dataDate: string, boardId: string) { return this.untrustedKeys.has(dataDate + '/' + boardId) }
  markUntrusted(dataDate: string, boardId: string) { this.untrustedKeys.add(dataDate + '/' + boardId) }
  clearUntrusted(dataDate: string, boardId: string) { this.untrustedKeys.delete(dataDate + '/' + boardId) }
  snapshotStats(dataDate: string): SnapshotStat[] {
    const out: SnapshotStat[] = []
    for (const [k, s] of this.snapshots) {
      const [boardId, d] = k.split('@')
      if (d !== dataDate) continue
      out.push({ boardId, size: JSON.stringify(s).length, mtimeMs: 0 })
    }
    return out
  }
}

/** 文件 store：按数据日期分目录；原子写（先 .tmp 再 rename）；同日覆盖 = 幂等 */
export class FileStore implements ScanStore {
  constructor(private root: string) {}
  private write(path: string, data: unknown) {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
    renameSync(tmp, path)
  }
  private read<T>(path: string): T | null {
    try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return null }
  }
  async getCancelFlag() {
    const p = join(this.root, 'state', 'cancel.json')
    if (!existsSync(p)) return false
    const j = this.read<{ cancel: boolean }>(p)
    return !!(j && j.cancel)
  }
  async setCancelFlag(v: boolean) {
    this.write(join(this.root, 'state', 'cancel.json'), { cancel: v, at: new Date().toISOString() })
  }
  async writeSnapshot(s: Snapshot) { this.write(join(this.root, s.dataDate, s.boardId + '.json'), s) }
  async writeScan(r: ScanRecord) { this.write(join(this.root, r.dataDate, 'scan.json'), r) }
  /**
   * ★ 2026-10-17：快照文件的写入时刻（毫秒）。给面板「本榜抓取」兜底 ——
   *   老数据没有 BoardResult.capturedAt 时，用它代替全局扫描时刻，至少不会 20 个榜同一个值。
   */
  snapshotMtime(boardId: string, dataDate: string): number | null {
    try { return statSync(join(this.root, dataDate, boardId + '.json')).mtimeMs } catch { return null }
  }
  async readScan(dataDate: string) { return this.read<ScanRecord>(join(this.root, dataDate, 'scan.json')) }
  private lockPath() { return join(this.root, 'state', 'scan.lock.json') }
  async acquireLock(info: LockInfo, staleMs: number) {
    const prev = this.read<LockInfo>(this.lockPath())
    if (prev) {
      // ★ 审计-2/42：心跳不可解析（NaN）时旧比较恒为 false ⇒ 锁永不接管、扫描永久卡住
      const at = Date.parse(prev.heartbeatAt)
      const stale = !Number.isFinite(at) ? true : Date.now() - at > staleMs
      if (!stale) return { ok: false, previous: prev }
      this.write(this.lockPath(), info)
      return { ok: true, previous: prev }
    }
    this.write(this.lockPath(), info)
    return { ok: true, previous: null }
  }
  async heartbeatLock(at: string) {
    const prev = this.read<LockInfo>(this.lockPath())
    if (prev) this.write(this.lockPath(), { ...prev, heartbeatAt: at })
  }
  async releaseLock() {
    try { rmSync(this.lockPath(), { force: true }) } catch { /* 释放失败不影响结果 */ }
  }
  async getRetryCount(boardId: string, dataDate: string) {
    const j = this.read<Record<string, number>>(join(this.root, 'state', 'retries.json')) || {}
    return j[dataDate + '/' + boardId] || 0
  }
  async bumpRetryCount(boardId: string, dataDate: string) {
    const p = join(this.root, 'state', 'retries.json')
    const j = this.read<Record<string, number>>(p) || {}
    const k = dataDate + '/' + boardId
    j[k] = (j[k] || 0) + 1
    this.write(p, j)
  }
  readSnapshot(dataDate: string, boardId: string) { return this.read<Snapshot>(join(this.root, dataDate, boardId + '.json')) }
  /**
   * ★ 工作包 A：逐榜·逐日状态索引。与 scan.json（批次记录）分开：
   *   一天 5 批扫描各写各的批次，但 day-index 只覆盖本批跑过的榜，其余榜保留。
   */
  readDayIndex(dataDate: string) { return this.read<DayIndex>(join(this.root, dataDate, 'day-index.json')) }
  async writeDayIndex(idx: DayIndex) { this.write(join(this.root, idx.dataDate, 'day-index.json'), idx) }
  /**
   * 「这一份快照不可信」的落盘标记（保留 raw，只隔离使用）。
   * 单独一个文件而不是只写 day-index：day-index 是派生索引，缺了/损坏了也不能让
   * 被拒的榜悄悄回到展示里（判据必须能在最坏情况下独立成立）。
   */
  private untrustedPath(dataDate: string, boardId: string) { return join(this.root, dataDate, boardId + '.untrusted.json') }
  isUntrusted(dataDate: string, boardId: string): boolean { return existsSync(this.untrustedPath(dataDate, boardId)) }
  readUntrusted(dataDate: string, boardId: string): { reason?: string; at?: string; by?: string } | null {
    return this.read(join(this.root, dataDate, boardId + '.untrusted.json'))
  }
  markUntrusted(dataDate: string, boardId: string, info: { reason: string; at: string; by: string }) {
    this.write(this.untrustedPath(dataDate, boardId), info)
  }
  clearUntrusted(dataDate: string, boardId: string) {
    try { rmSync(this.untrustedPath(dataDate, boardId), { force: true }) } catch { /* 清标记失败不影响读取 */ }
  }
  /** 当天所有快照的大小/修改时间（供数据 revision 摘要；不解析内容） */
  snapshotStats(dataDate: string): SnapshotStat[] {
    const dir = join(this.root, dataDate)
    if (!existsSync(dir)) return []
    const out: SnapshotStat[] = []
    let names: string[] = []
    try { names = readdirSync(dir) } catch { return [] }
    for (const f of names) {
      if (!f.endsWith('.json')) continue
      if (f === 'scan.json' || f === 'day-index.json' || f.endsWith('.untrusted.json')) continue
      try {
        const st = statSync(join(dir, f))
        out.push({ boardId: f.replace(/\.json$/, ''), size: st.size, mtimeMs: st.mtimeMs })
      } catch { /* 单个文件读不到就跳过 */ }
    }
    return out
  }
  /** 当天被拒的榜（供 revision 摘要区分「隔离前后」） */
  untrustedBoards(dataDate: string): string[] {
    const dir = join(this.root, dataDate)
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir).filter((f) => f.endsWith('.untrusted.json')).map((f) => f.replace(/\.untrusted\.json$/, ''))
    } catch { return [] }
  }
}