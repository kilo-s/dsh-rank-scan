import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
/** 内存 store：测试与干跑用 */
export class MemoryStore {
    snapshots = new Map();
    scans = [];
    cancel = false;
    retries = new Map();
    lock = null;
    async acquireLock(info, staleMs) {
        if (!this.lock) {
            this.lock = info;
            return { ok: true, previous: null };
        }
        const stale = Date.now() - Date.parse(this.lock.heartbeatAt) > staleMs;
        if (!stale)
            return { ok: false, previous: this.lock };
        const previous = this.lock;
        this.lock = info;
        return { ok: true, previous };
    }
    async heartbeatLock(at) { if (this.lock)
        this.lock.heartbeatAt = at; }
    async releaseLock() { this.lock = null; }
    async getCancelFlag() { return this.cancel; }
    async setCancelFlag(v) { this.cancel = v; }
    async writeSnapshot(s) { this.snapshots.set(s.boardId + '@' + s.dataDate, s); }
    async writeScan(r) { this.scans.push(r); }
    async readScan(dataDate) { return this.scans.filter((s) => s.dataDate === dataDate).slice(-1)[0] || null; }
    async getRetryCount(boardId, dataDate) { return this.retries.get(boardId + '@' + dataDate) || 0; }
    async bumpRetryCount(boardId, dataDate) {
        const k = boardId + '@' + dataDate;
        this.retries.set(k, (this.retries.get(k) || 0) + 1);
    }
    snapshot(boardId, dataDate) { return this.snapshots.get(boardId + '@' + dataDate) || null; }
}
/** 文件 store：按数据日期分目录；原子写（先 .tmp 再 rename）；同日覆盖 = 幂等 */
export class FileStore {
    root;
    constructor(root) {
        this.root = root;
    }
    write(path, data) {
        mkdirSync(dirname(path), { recursive: true });
        const tmp = path + '.tmp';
        writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
        renameSync(tmp, path);
    }
    read(path) {
        try {
            return JSON.parse(readFileSync(path, 'utf8'));
        }
        catch {
            return null;
        }
    }
    async getCancelFlag() {
        const p = join(this.root, 'state', 'cancel.json');
        if (!existsSync(p))
            return false;
        const j = this.read(p);
        return !!(j && j.cancel);
    }
    async setCancelFlag(v) {
        this.write(join(this.root, 'state', 'cancel.json'), { cancel: v, at: new Date().toISOString() });
    }
    async writeSnapshot(s) { this.write(join(this.root, s.dataDate, s.boardId + '.json'), s); }
    async writeScan(r) { this.write(join(this.root, r.dataDate, 'scan.json'), r); }
    async readScan(dataDate) { return this.read(join(this.root, dataDate, 'scan.json')); }
    lockPath() { return join(this.root, 'state', 'scan.lock.json'); }
    async acquireLock(info, staleMs) {
        const prev = this.read(this.lockPath());
        if (prev) {
            const stale = Date.now() - Date.parse(prev.heartbeatAt) > staleMs;
            if (!stale)
                return { ok: false, previous: prev };
            this.write(this.lockPath(), info);
            return { ok: true, previous: prev };
        }
        this.write(this.lockPath(), info);
        return { ok: true, previous: null };
    }
    async heartbeatLock(at) {
        const prev = this.read(this.lockPath());
        if (prev)
            this.write(this.lockPath(), { ...prev, heartbeatAt: at });
    }
    async releaseLock() {
        try {
            rmSync(this.lockPath(), { force: true });
        }
        catch { /* 释放失败不影响结果 */ }
    }
    async getRetryCount(boardId, dataDate) {
        const j = this.read(join(this.root, 'state', 'retries.json')) || {};
        return j[dataDate + '/' + boardId] || 0;
    }
    async bumpRetryCount(boardId, dataDate) {
        const p = join(this.root, 'state', 'retries.json');
        const j = this.read(p) || {};
        const k = dataDate + '/' + boardId;
        j[k] = (j[k] || 0) + 1;
        this.write(p, j);
    }
    readSnapshot(dataDate, boardId) { return this.read(join(this.root, dataDate, boardId + '.json')); }
}
//# sourceMappingURL=store.js.map