import { MissingError } from '../scan/types.js';
import { boundedFetch } from '../scan/bounded-fetch.js';
/**
 * 起点榜适配器（移动端，免 cookie）。
 * 实测（2026-10-14）：榜单页 SSR 内 <script id="vite-plugin-ssr_pageContext"> 的
 * pageProps.pageData = { total, gender, isLast, records[] }，
 * 单条 = { catId, bName, rankNum, cat, cnt, subCatId, bid, subCat, bAuth, desc }
 */
export const CATEGORIES = {
    全站: -1, 玄幻: 21, 奇幻: 1, 武侠: 2, 仙侠: 22, 都市: 4, 现实: 15,
    军事: 6, 历史: 5, 游戏: 7, 体育: 8, 科幻: 9, 悬疑灵异: 10, 诸天无限: 20109, 轻小说: 12,
};
export const QIDIAN_BOARDS = {
    yuepiao: '月票榜', hotsales: '畅销榜', readindex: '阅读榜', newfans: '书友榜',
    rec: '推荐榜', update: '更新榜', sign: '签约榜', newbook: '新书榜', newauthor: '新人榜',
};
export const BOARD_PAGE_ROWS = 20;
export function boardId(slug, catId) {
    return 'qidian.' + slug + '.cat' + catId;
}
export function parseRankPage(html) {
    const m = html.match(/<script id="vite-plugin-ssr_pageContext"[^>]*>([\s\S]*?)<\/script>/);
    if (!m)
        throw new MissingError('榜单页结构变化：未找到 pageContext');
    let data;
    try {
        data = JSON.parse(m[1]).pageContext.pageProps.pageData;
    }
    catch (e) {
        throw new MissingError('榜单页 JSON 解析失败');
    }
    if (!data || !Array.isArray(data.records))
        throw new MissingError('榜单页无 records');
    const rows = data.records.map((r) => ({
        key: String(r.bid),
        rank: typeof r.rankNum === 'number' ? r.rankNum : null,
        value: null,
        title: String(r.bName || ''),
        author: r.bAuth ? String(r.bAuth) : null,
        url: 'https://www.qidian.com/book/' + r.bid + '/',
        extra: {
            cat: r.cat == null ? null : r.cat,
            subCat: r.subCat == null ? null : r.subCat,
            wordsText: r.cnt == null ? null : r.cnt,
            desc: r.desc == null ? null : r.desc,
            catId: r.catId == null ? null : r.catId,
        },
    }));
    return { total: Number(data.total || rows.length), rows };
}
/** 书页解析：只取收藏与精确字数（缺失一律 null，不补 0） */
export function parseBookPage(html) {
    const c = html.match(/"collect"\s*:\s*(\d+)/);
    const w = html.match(/"wordsCnt"\s*:\s*(\d+)/);
    return { collect: c ? Number(c[1]) : null, wordsCnt: w ? Number(w[1]) : null };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function makeQidianMobileSite(opts = {}) {
    const slugs = opts.boards || ['sign'];
    const cats = opts.categories || ['轻小说'];
    const fetchText = opts.fetchText || (async (url, c) => {
        const res = (await boundedFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: c?.signal, timeoutMs: c?.requestTimeoutMs }));
        if (res.status === 202)
            throw new MissingError('起点反爬挑战（202）');
        if (!res.ok)
            throw new MissingError('HTTP ' + res.status);
        return await res.text();
    });
    const rateMinMs = typeof opts.rateMinMs === 'number' ? opts.rateMinMs : 1000;
    const maxRetry = typeof opts.maxRetry === 'number' ? opts.maxRetry : 2;
    const boards = opts.boardIds && opts.boardIds.length ? opts.boardIds.slice() : [];
    if (!boards.length) {
        for (const s of slugs)
            for (const c of cats)
                boards.push(boardId(s, CATEGORIES[c] == null ? -1 : CATEGORIES[c]));
    }
    return {
        id: 'qidian-mobile',
        site: '起点榜',
        metric: 'rank',
        boards,
        async fetchBoard(id, ctx) {
            const parts = id.split('.');
            const slug = parts[1];
            const catId = Number(id.split('cat')[1]);
            const url = 'https://m.qidian.com/rank/' + slug + '/catid' + catId + '/';
            const t0 = Date.now();
            const html = await fetchText(url, ctx);
            const parsed = parseRankPage(html);
            if (parsed.rows.length !== BOARD_PAGE_ROWS) {
                throw new MissingError('条数异常：' + parsed.rows.length + '（期望 ' + BOARD_PAGE_ROWS + '）');
            }
            return { boardId: id, status: 'ok', rows: parsed.rows, requests: 1, durationMs: Date.now() - t0, warnings: [] };
        },
        async enrich(_boardId, rows, ctx) {
            let requests = 0;
            const out = [];
            for (let i = 0; i < rows.length; i++) {
                if (ctx.signal.aborted)
                    break;
                if (i > 0 && rateMinMs > 0)
                    await sleep(rateMinMs);
                const row = rows[i];
                let stat = null;
                for (let attempt = 0; attempt <= maxRetry; attempt++) {
                    requests += 1;
                    try {
                        const html = await fetchText('https://m.qidian.com/book/' + row.key + '/', ctx);
                        stat = parseBookPage(html);
                        break;
                    }
                    catch (e) {
                        stat = null;
                    }
                }
                out.push({
                    ...row,
                    extra: {
                        ...(row.extra || {}),
                        collect: stat ? stat.collect : null,
                        wordsCnt: stat ? stat.wordsCnt : null,
                    },
                });
            }
            return { rows: out, requests };
        },
        /**
         * 单本取书页统计（供主人侧做**书页缓存**：同一本书在 TTL 内不再重复下载 103KB 页面）。
         * 刻意**不做内部重试**：单次请求、失败抛错，由调用方决定跳过（不缓存坏结果）。
         */
        async fetchBookStats(bid, ctx) {
            const html = await fetchText('https://m.qidian.com/book/' + encodeURIComponent(String(bid)) + '/', ctx);
            return parseBookPage(html);
        },
    };
}
//# sourceMappingURL=qidian-mobile.js.map