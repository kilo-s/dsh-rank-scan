import { type BoardCtx, type Row, type SiteAdapter } from '../scan/types.js';
/**
 * 起点榜适配器（移动端，免 cookie）。
 * 实测（2026-10-14）：榜单页 SSR 内 <script id="vite-plugin-ssr_pageContext"> 的
 * pageProps.pageData = { total, gender, isLast, records[] }，
 * 单条 = { catId, bName, rankNum, cat, cnt, subCatId, bid, subCat, bAuth, desc }
 */
export declare const CATEGORIES: Record<string, number>;
export declare const QIDIAN_BOARDS: Record<string, string>;
export declare const BOARD_PAGE_ROWS = 20;
export declare function boardId(slug: string, catId: number): string;
export declare function parseRankPage(html: string): {
    total: number;
    rows: Row[];
};
/** 书页解析：只取收藏与精确字数（缺失一律 null，不补 0） */
export declare function parseBookPage(html: string): {
    collect: number | null;
    wordsCnt: number | null;
};
export declare function makeQidianMobileSite(opts?: {
    boards?: string[];
    /** 直接给 boardId 列表（优先于 boards × categories） */
    boardIds?: string[];
    categories?: string[];
    fetchText?: (url: string, ctx: BoardCtx) => Promise<string>;
    /** 请求最小间隔（默认 1000ms = 采集纪律） */
    rateMinMs?: number;
    /** 单条失败重试次数（默认 2） */
    maxRetry?: number;
}): SiteAdapter;
