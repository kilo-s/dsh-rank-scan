import type { Row } from './types.js';
/** 与上一次有效快照的交集条数 */
export declare function overlapCount(current: Row[], previous: Row[]): number;
/** 换榜 / 降级：与上次有效快照交集 ≤ 2（刺猬猫判据） */
export declare function looksSwapped(current: Row[], previous: Row[], threshold?: number): boolean;
/** 未刷新：与最近若干天里的任一版本完全一致（菠萝包判据） */
export declare function looksUnchanged(current: Row[], versions: Row[][]): boolean;
