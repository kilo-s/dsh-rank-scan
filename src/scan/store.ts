import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ScanRecord, Snapshot } from './types.js'
import type { LockInfo, ScanStore } from './run.js'

/** 内存 store：测试与干跑用 */
export class MemoryStore implements ScanStore {
  snapshots = new Map<string, Snapshot>()
  scans: ScanRecord[] = []
  cancel = false
  retries = new Map<string, number>()
  lock: LockInfo | null = null
  async acquireLock(info: LockInfo, staleMs: number) {
    if (!this.lock) { this.lock = info; return { ok: true, previous: null } }
    const stale = Date.now() - Date.parse(this.lock.heartbeatAt) > staleMs
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
  async readScan(dataDate: string) { return this.read<ScanRecord>(join(this.root, dataDate, 'scan.json')) }
  private lockPath() { return join(this.root, 'state', 'scan.lock.json') }
  async acquireLock(info: LockInfo, staleMs: number) {
    const prev = this.read<LockInfo>(this.lockPath())
    if (prev) {
      const stale = Date.now() - Date.parse(prev.heartbeatAt) > staleMs
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
}