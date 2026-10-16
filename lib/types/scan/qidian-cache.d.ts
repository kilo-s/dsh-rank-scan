/**
 * 起点**书页缓存**（2026-10-15）。
 *
 * 为什么需要它：起点官方任何榜单页都不带收藏，收藏只存在于作品页里
 * （m.qidian.com/book/<bid>/，实测 200 且单页约 103 KB）。所以想看收藏，就必须逐本进书页。
 * 而一天一次的全站扫描里，榜单 Top N 与前一天通常高度重合 —— 重复下载同一本书页是纯浪费。
 * 缓存命中就跳过请求：20 本里通常只有新入榜/过期的那几本要打。
 *
 * 缓存内容（**只存书页真能给的字段**，缺的就是缺，不编）：
 *   - collect   总收藏（整数）
 *   - wordsCnt  精确字数（整数）
 *   - title     书名（书页 og:title / 章节信息里的书名，可作为字体反爬的干净对照）
 *   - fetchedAt 抓取时间（ISO），TTL 与面板「数据截止」都靠它
 *
 * 纪律：只缓存**拿到 collect 的结果**（拿不到说明这页没解析出东西，不入缓存，下次重试）；
 *      缺值一律 null，绝不补 0。
 */
export interface BookStat {
    collect: number | null;
    wordsCnt: number | null;
    title?: string | null;
    fetchedAt: string;
}
/** 命中的缓存条目；hit=false 表示「没有或已过期，需要重新请求」 */
export declare function cachedBook(root: string, bid: string, ttlMs: number): {
    hit: boolean;
    hitAt: string | null;
    stat: BookStat | null;
};
/** 写入一批（原子写：tmp + rename）；只接受拿到 collect 的条目 */
export declare function putCachedBooks(root: string, entries: {
    key: string;
    collect: number | null;
    wordsCnt: number | null;
    title?: string | null;
}[]): number;
export declare function cacheStats(root: string): {
    books: number;
    newest: string | null;
};
export declare function clearCache(root: string): boolean;
