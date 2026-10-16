import { MissingError } from '../scan/types.js';
import { boundedFetch } from '../scan/bounded-fetch.js';
import { hasPua } from '../scan/fontmap.js';
/**
 * 番茄（fanqienovel.com）适配器 —— 分类榜（数值型：在读人数）。
 * 实测（2026-10-14，只读取证）：
 * - 接口 /api/rank/category/list；每页 10 条、每榜上限 100（offset 步进 10）
 * - 字段：bookId / bookName / author / wordNumber / read_count（真实在读；readCount 恒 "0" 是废弃字段）
 * - ⚠ 字体反爬：bookName/author/abstract 会缺字（榜单接口与 SSR 都缺），
 *   要干净文本需再打 /api/book/info?bookId=（每本 1 请求）⇒ 默认不补，标记 titleSuspect
 * - ⚠ rankMold 语义：菜单显示 1=新书榜、2=阅读榜，但本轮未实测确认（只验证了字符串 read 的写法不可靠）
 * - 分类 37 个（男 19 / 女 18），其中 8 / 746 / 539 三个 id 男女频共用 ⇒ 复合键 (gender, catId)
 */
export const FANQIE_MALE = [
    [1141, '西方奇幻'], [1140, '东方仙侠'], [8, '科幻末世'], [261, '都市日常'], [124, '都市修真'],
    [1014, '都市高武'], [273, '历史古代'], [27, '战神赘婿'], [263, '都市种田'], [258, '传统玄幻'],
    [272, '历史脑洞'], [539, '悬疑脑洞'], [262, '都市脑洞'], [257, '玄幻脑洞'], [751, '悬疑灵异'],
    [504, '抗战谍战'], [746, '游戏体育'], [718, '动漫衍生'], [1016, '男频衍生'],
];
export const FANQIE_FEMALE = [
    [1139, '古风世情'], [8, '科幻末世'], [746, '游戏体育'], [1015, '女频衍生'], [248, '玄幻言情'],
    [23, '种田'], [79, '年代'], [267, '现言脑洞'], [246, '宫斗宅斗'], [539, '悬疑脑洞'], [253, '古言脑洞'],
    [24, '快穿'], [749, '青春甜宠'], [745, '星光璀璨'], [747, '女频悬疑'], [750, '职场婚恋'],
    [748, '豪门总裁'], [1017, '民国言情'],
];
export const FANQIE_MOLDS = { read: '2', new: '1' };
export function fanqieBoardId(gender, mold, catId) {
    return 'fanqie.' + gender + '.' + mold + '.' + catId;
}
/**
 * 解析榜单接口。`decode` = 字体映射解码器（见 scan/fontmap.ts）：
 * 原始文本存进 extra.titlePua / authorPua，供补全时学映射；解码后若仍有私用区码点 ⇒ titleSuspect 仍为 true。
 */
export function parseRankApi(json, decode) {
    const list = json && json.data && json.data.book_list;
    if (!Array.isArray(list))
        return [];
    const dec = (s) => (decode ? decode(s) : s);
    return list.map((b) => {
        const rawTitle = String(b.bookName || '');
        const rawAuthor = b.author ? String(b.author) : null;
        const title = dec(rawTitle);
        const author = rawAuthor ? dec(rawAuthor) : null;
        return {
            key: String(b.bookId),
            rank: Number.isFinite(Number(b.currentPos)) ? Number(b.currentPos) : null,
            value: Number.isFinite(Number(b.read_count)) ? Number(b.read_count) : null,
            title,
            author,
            url: 'https://fanqienovel.com/page/' + b.bookId,
            extra: {
                wordNumber: b.wordNumber != null ? Number(b.wordNumber) : null,
                rankPosDiff: b.rankPosDiff != null ? Number(b.rankPosDiff) : null,
                lastChapterUpdateTime: b.lastChapterUpdateTime != null ? Number(b.lastChapterUpdateTime) : null,
                uid: b.uid != null ? String(b.uid) : null,
                catId: b.curent_category_id != null ? Number(b.curent_category_id) : null,
                titlePua: hasPua(rawTitle) ? rawTitle : undefined,
                authorPua: rawAuthor && hasPua(rawAuthor) ? rawAuthor : undefined,
                titleSuspect: hasPua(title) || hasPua(author),
            },
        };
    });
}
export function makeFanqieSite(opts = {}) {
    const boards = opts.boards && opts.boards.length ? opts.boards : [];
    const limit = typeof opts.limit === 'number' ? opts.limit : 10;
    const fetchJson = opts.fetchJson || (async (url, c) => {
        const res = (await boundedFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: c?.signal, timeoutMs: c?.requestTimeoutMs }));
        if (!res.ok)
            throw new MissingError('HTTP ' + res.status);
        return JSON.parse(await res.text());
    });
    return {
        id: 'fanqie',
        site: '番茄',
        metric: 'value',
        boards,
        async fetchBoard(id, ctx) {
            const parts = id.split('.');
            if (parts.length !== 4)
                throw new MissingError('榜 id 形如 fanqie.m.read.1141，实际：' + id);
            const gender = parts[1] === 'f' ? '0' : '1';
            const mold = FANQIE_MOLDS[parts[2]] || '2';
            const catId = parts[3];
            const depth = Math.max(limit, Math.min(100, opts.depthOf ? opts.depthOf(id) : limit));
            const pages = Math.ceil(depth / limit);
            const boardUrl = (offset) => 'https://fanqienovel.com/api/rank/category/list?app_id=1967&rank_list_type=3&rank_version=&rankMold=' +
                mold +
                '&gender=' +
                gender +
                '&category_id=' +
                catId +
                '&limit=' +
                limit +
                '&offset=' +
                offset;
            const t0 = Date.now();
            let requests = 0;
            const seen = new Set();
            const rows = [];
            for (let page = 0; page < pages; page++) {
                const json = await fetchJson(boardUrl(page * limit), ctx);
                requests += 1;
                if (json && json.code !== 0)
                    throw new MissingError('接口 code=' + json.code + ' ' + (json.message || ''));
                const part = parseRankApi(json, opts.decode);
                if (!part.length)
                    break;
                for (const r of part) {
                    if (seen.has(r.key))
                        continue;
                    seen.add(r.key);
                    rows.push(r);
                }
                if (part.length < limit)
                    break;
            }
            if (!rows.length)
                throw new MissingError('榜单为空（book_list 空）');
            const warnings = ['书名/作者可能因番茄字体反爬缺字（titleSuspect）'];
            if (depth > limit)
                warnings.push('已取前 ' + Math.min(depth, rows.length) + ' 条（' + requests + ' 页）');
            return {
                boardId: id,
                status: 'ok',
                rows: rows.slice(0, depth),
                requests,
                durationMs: Date.now() - t0,
                warnings,
            };
        },
    };
}
//# sourceMappingURL=fanqie.js.map