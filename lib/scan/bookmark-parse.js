/**
 * 书签 · 输入解析（纯函数，可单测）。host 与 client **共用同一份规则**，避免两处解析不一致。
 * 词汇对齐 docs/rank-scan/CONTEXT.md：书签 / 我的书签 / 书签夹 / 备注；bookKey = 站命名空间 + 站内书号。
 */
/** 各站的书写特征（顺序敏感：先匹配更具体的站，避免误判） */
const SITE_RULES = [
    { site: 'qidiantu', idAfter: /qidiantu\.com\/info\/(\d+)/i, url: (id) => 'https://www.qidiantu.com/info/' + id },
    { site: 'sfacg', idAfter: /book\.sfacg\.com\/Novel\/(\d+)/i, url: (id) => 'https://book.sfacg.com/Novel/' + id + '/' },
    { site: 'ciweimao', idAfter: /ciweimao\.com\/book\/(\d+)/i, url: (id) => 'https://www.ciweimao.com/book/' + id },
    { site: 'qidian', idAfter: /qidian\.com\/book\/(\d+)/i, url: (id) => 'https://www.qidian.com/book/' + id + '/' },
    { site: 'fanqie', idAfter: /fanqienovel\.com\/page\/(\d+)/i, url: (id) => 'https://fanqienovel.com/page/' + id },
];
/**
 * 归一化书号：去前后空白、去尾斜杠；**只对纯数字做「去前导零」**，番茄的 19 位十进制一律按字符串原样保留。
 * ★ 番茄书号是 19 位十进制 —— 绝不能 Number() 化（7685322774750956568 → 7685322774750956000，精度直接丢）。
 */
export function normalizeBookId(raw) {
    const s = String(raw == null ? '' : raw).trim().replace(/\/+$/, '');
    if (!s)
        return '';
    return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s;
}
/**
 * 站 → bookKey 前缀。
 * ★ 起点图的书号与起点**同源**（同一本书号），所以归并到同一个命名空间 —— 这是「同一本书在起点与起点图各打一次只出一条」的前提。
 */
const NAMESPACE = { qidian: 'qidian', qidiantu: 'qidian', ciweimao: 'ciweimao', sfacg: 'sfacg', fanqie: 'fanqie' };
export function bookKeyOf(site, id) {
    const ns = NAMESPACE[site] || site;
    return ns + ':' + normalizeBookId(id);
}
/**
 * 解析用户输入 ⇒ 作品引用。接受：
 * - 整条书页 URL（qidian / ciweimao / sfacg / qidiantu.com/info / fanqienovel.com/page）
 * - 带命名空间前缀：qidian:1039… / fanqie:7632… / qidiantu:… / ciweimao:… / sfacg:…
 * - 纯书号（需给出 site；起点图会归并到 qidian 命名空间）
 * 解析不出来就返回 null —— 不猜。
 */
export function parseBookInput(input, site) {
    const s = String(input == null ? '' : input).trim();
    if (!s)
        return null;
    for (const r of SITE_RULES) {
        const m = s.match(r.idAfter);
        if (m) {
            const id = normalizeBookId(m[1]);
            return id ? { site: r.site, key: id, bookKey: bookKeyOf(r.site, id), url: r.url(id) } : null;
        }
    }
    const p = s.match(/^([a-z]+)\s*[:：]\s*(\S+)$/i);
    if (p) {
        const ns = p[1].toLowerCase();
        const id = normalizeBookId(p[2]);
        const hit = Object.keys(NAMESPACE).find((k) => k === ns);
        if (hit && id)
            return { site: hit, key: id, bookKey: bookKeyOf(hit, id), url: urlFor(hit, id) };
        if (ns === 'fanqienovel' && id)
            return { site: 'fanqie', key: id, bookKey: bookKeyOf('fanqie', id), url: urlFor('fanqie', id) };
    }
    if (/^\d+$/.test(s)) {
        const id = normalizeBookId(s);
        if (!site)
            return null;
        const sid = Object.keys(NAMESPACE).find((k) => k === site);
        if (!sid || !id)
            return null;
        return { site: sid, key: id, bookKey: bookKeyOf(sid, id), url: urlFor(sid, id) };
    }
    return null;
}
export function urlFor(site, id) {
    const r = SITE_RULES.find((x) => x.site === site);
    return r ? r.url(normalizeBookId(id)) : '';
}
/** 备注里的 #标签 提取（去重、保持出现顺序，最多 20 个） */
export function extractTags(note) {
    const out = [];
    const s = String(note == null ? '' : note);
    for (const m of s.matchAll(/#([^\s#]{1,20})/g)) {
        const t = m[1].trim();
        if (t && !out.includes(t))
            out.push(t);
        if (out.length >= 20)
            break;
    }
    return out;
}
/** 书签里该显示的文字：书名优先，其次用户输入（输入永不被自动更新覆盖），最后退化到书号 */
export function displayLabel(b) {
    const t = String(b.title == null ? '' : b.title).trim();
    if (t)
        return t;
    const i = String(b.input == null ? '' : b.input).trim();
    if (i)
        return i;
    return b.bookKey;
}
/** 距今天数（本地自然日口径，与「数据日期」一致）。传 dateOnly 时按 YYYY-MM-DD 比。 */
export function daysSince(iso, nowMs) {
    if (!iso)
        return null;
    const t = Date.parse(String(iso));
    if (!Number.isFinite(t))
        return null;
    return Math.max(0, Math.round((nowMs - t) / 86400000));
}
//# sourceMappingURL=bookmark-parse.js.map