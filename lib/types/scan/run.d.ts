import { type Budget, type ScanRecord, type SiteAdapter, type Snapshot } from './types.js';
export interface Clock {
    now(): Date;
}
export interface LockInfo {
    startedAt: string;
    heartbeatAt: string;
    pid?: number;
}
export interface ScanStore {
    getCancelFlag(): Promise<boolean>;
    setCancelFlag(v: boolean): Promise<void>;
    writeSnapshot(s: Snapshot): Promise<void>;
    writeScan(r: ScanRecord): Promise<void>;
    /** 读当天已有扫描记录（重试模式要用；缺省视为不支持） */
    readScan?(dataDate: string): Promise<ScanRecord | null>;
    /** 某榜某天的重试次数（缺省视为不限） */
    getRetryCount?(boardId: string, dataDate: string): Promise<number>;
    bumpRetryCount?(boardId: string, dataDate: string): Promise<void>;
    /** 扫描锁：同一时刻只允许一轮。心跳过期（> staleMs）视为上一轮 crashed，可接管 */
    acquireLock?(info: LockInfo, staleMs: number): Promise<{
        ok: boolean;
        previous: LockInfo | null;
    }>;
    heartbeatLock?(at: string): Promise<void>;
    releaseLock?(): Promise<void>;
}
export interface RunScanDeps {
    sites: SiteAdapter[];
    clock: Clock;
    store: ScanStore;
    budget?: Partial<Budget>;
    trigger?: 'manual' | 'timer';
    /** 只扫这些榜（默认全部） */
    boards?: string[];
    /** 是否补字段（默认关闭；开启会显著增加请求数） */
    enrich?: boolean;
    /** 只重跑当天非 ok 的榜（已 ok 的榜不动），结果并回同一天的记录 */
    retryNonOk?: boolean;
    /** 同一个站连续失败到该次数 ⇒ 熔断：本站剩余榜不再请求 */
    maxSiteFailures?: number;
    /** 每榜每天最大重试次数（默认 2） */
    maxRetryPerBoard?: number;
    /** 取消标志轮询间隔（默认 500ms；测试可调小） */
    pollMs?: number;
    /** 榜与榜之间的最小间隔（默认 0；采集纪律建议 1000ms） */
    betweenBoardsMs?: number;
    signal?: AbortSignal;
    onProgress?: (r: ScanRecord) => void;
}
/** 数据日期 = 本地自然日（忌用 toISOString：北京时间凌晨会差一天） */
export declare function localDate(d: Date): string;
/** 唯一的扫描用例（测试 seam）：依赖全部注入 */
export declare function runScan(deps: RunScanDeps): Promise<ScanRecord>;
