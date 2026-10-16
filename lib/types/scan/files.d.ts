import type { HistoryEntry } from './diff.js';
import { addDays } from './diff.js';
import type { ScanRecord, Snapshot } from './types.js';
export interface SlimRow {
    key: string;
    metric: number | null;
    rank: number | null;
}
export interface SlimIndex {
    dataDate: string;
    boards: Record<string, SlimRow[]>;
}
/**
 * ★ 2026-10-16（审计 P0-2）：一切「用日期拼路径」的入口都必须先过这里。
 * 这些 date 来自 POST body / 面板日期框，不校验时 join(root, '..') 就能删或写到数据根之外
 * （实测 `POST /repair {"mode":"drop","date":".."}` 会 rmSync 掉 ~/.dsh/data，而且是未鉴权可达）。
 * 只接受严格的 YYYY-MM-DD，其余一律抛错 —— 调用方把错误翻成 400。
 */
export declare function assertDataDate(input: unknown): string;
/** 数据目录下的数据日期列表（升序） */
export declare function listDataDates(root: string): string[];
/** 保留策略 → 该删哪些数据日期 */
export declare function planCleanup(dates: string[], today: string, keepDays: number | 'forever'): string[];
export declare function dirSize(path: string): number;
/** 删除指定数据日期目录，返回释放的字节数 */
export declare function applyCleanup(root: string, dates: string[]): number;
/**
 * 保留策略执行（纯文件操作，可离线单测）：按 keepDays 删掉过期的**数据日期目录**。
 * ★ 只删 `<root>/<YYYY-MM-DD>/`；**绝不触碰 `state/`**（配置、书签、书页缓存都在里面）。
 * 返回被删的日期与释放字节数，供调用方记日志 / 面板展示。
 */
export declare function runRetention(root: string, today: string, keepDays: number | 'forever'): {
    removed: string[];
    freed: number;
};
/**
 * ★ 2026-10-16（属主提的缺口）：保留策略的**输入规范化**。
 * 面板以前只能显示「保留 N 天」，改不了；现在可选 7–3650 天或永久（'forever'）。
 * 返回 null 表示输入非法（调用方回 400）。
 */
export declare function normalizeRetention(input: unknown): number | 'forever' | null;
/** 导出：把 [from, to] 区间的快照与报告复制到目标目录（不含 state/，凭证不在数据目录） */
export declare function exportRange(root: string, from: string, to: string, destDir: string): string[];
export declare function writeSlim(root: string, s: SlimIndex): string;
export declare function readSlim(root: string, dataDate: string): SlimIndex | null;
export declare function listSlim(root: string): string[];
export declare function writeReport(root: string, dataDate: string, md: string): string;
/** 从扫描记录 + 当天快照抽精简索引（书号 / 指标 / 名次） */
export declare function buildSlim(record: ScanRecord, snapshots: Map<string, Snapshot>): SlimIndex;
/** 某榜历史（默认取今天之前的全部精简索引） */
export declare function historyFor(indexes: SlimIndex[], boardId: string, beforeDate: string): Map<string, HistoryEntry>;
/** 上一次可用快照的数据日期（今天之前最近的一天） */
export declare function previousDataDate(dates: string[], today: string): string | null;
export { addDays };
