import type { Row } from './types.js';
/**
 * 番茄派生榜（2026-10-15 属主定稿，**自然周口径**）—— 全部由已落盘快照算出，**不发任何请求**。
 *
 * 为什么是「自然周」而不是「最近 7 个数据日」：
 *   - 滚动窗口下每本书的基准是它**自己** 7 天前那条 ⇒ 入池 3 天的书只有 3 天涨幅，
 *     却要和入池 5 年的书同榜比，**横向不可比**；
 *   - 「从入池起累加每日涨幅」在数学上恒等于「今天的在读数」，等于没做统计（属主 2026-10-15 指出）；
 *   - 因此照搬起点图三江榜的口径：**同一期首日 + 期内累加每日增量 + 已结算 N 天**，
 *     全站共用同一个基准日，N 本书才可比。
 *
 * 周期 = 自然周（周一~周日）。期首冻结基准读数，期内只累加每日增量（日粒度，怕丢一天数据）。
 * 榜单默认按**今日涨幅**倒序（属主 2026-10-15），另提供「本周累计涨幅」倒序排序项。
 */
export interface SnapshotLike {
    boardId: string;
    dataDate: string;
    metric: string;
    rows: Row[];
}
export type SnapshotReader = (boardId: string, date: string) => SnapshotLike | null;
export interface DerivedView {
    boardId: string;
    title: string;
    rows: Row[];
    /** 参与计算的数据日期（升序，落在本期内的） */
    dates: string[];
    windowStart: string | null;
    periodStart: string;
    periodEnd: string;
    periodIndex: number;
    settledDays: number;
    /** 应已过天数（周一=1 … 周日=7），用于暴露「有几天没抓到」 */
    elapsed: number;
    /** 实际有数据的日期（MM-DD，顿号分隔），写进说明让人一眼看懂缺口 */
    datesLabel: string;
    note: string | null;
}
/** 本周周一（本地时区），自然周口径的期首 */
export declare function weekStart(date: string): string;
export declare function deriveFanqieViews(read: SnapshotReader, opts: {
    date: string;
    poolBoards: string[];
    dataDates: string[];
}): DerivedView[];
