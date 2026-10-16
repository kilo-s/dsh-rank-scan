import type { ScanRecord, Snapshot } from './types.js';
import type { LockInfo, ScanStore } from './run.js';
/** 内存 store：测试与干跑用 */
export declare class MemoryStore implements ScanStore {
    snapshots: Map<string, Snapshot>;
    scans: ScanRecord[];
    cancel: boolean;
    retries: Map<string, number>;
    lock: LockInfo | null;
    acquireLock(info: LockInfo, staleMs: number): Promise<{
        ok: boolean;
        previous: null;
    } | {
        ok: boolean;
        previous: LockInfo;
    }>;
    heartbeatLock(at: string): Promise<void>;
    releaseLock(): Promise<void>;
    getCancelFlag(): Promise<boolean>;
    setCancelFlag(v: boolean): Promise<void>;
    writeSnapshot(s: Snapshot): Promise<void>;
    writeScan(r: ScanRecord): Promise<void>;
    readScan(dataDate: string): Promise<ScanRecord>;
    getRetryCount(boardId: string, dataDate: string): Promise<number>;
    bumpRetryCount(boardId: string, dataDate: string): Promise<void>;
    snapshot(boardId: string, dataDate: string): Snapshot | null;
}
/** 文件 store：按数据日期分目录；原子写（先 .tmp 再 rename）；同日覆盖 = 幂等 */
export declare class FileStore implements ScanStore {
    private root;
    constructor(root: string);
    private write;
    private read;
    getCancelFlag(): Promise<boolean>;
    setCancelFlag(v: boolean): Promise<void>;
    writeSnapshot(s: Snapshot): Promise<void>;
    writeScan(r: ScanRecord): Promise<void>;
    readScan(dataDate: string): Promise<ScanRecord | null>;
    private lockPath;
    acquireLock(info: LockInfo, staleMs: number): Promise<{
        ok: boolean;
        previous: LockInfo;
    } | {
        ok: boolean;
        previous: null;
    }>;
    heartbeatLock(at: string): Promise<void>;
    releaseLock(): Promise<void>;
    getRetryCount(boardId: string, dataDate: string): Promise<number>;
    bumpRetryCount(boardId: string, dataDate: string): Promise<void>;
    readSnapshot(dataDate: string, boardId: string): Snapshot | null;
}
