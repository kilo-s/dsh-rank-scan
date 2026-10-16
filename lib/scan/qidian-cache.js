import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const VERSION = 1;
const MAX_ENTRIES = 1000;
function load(root) {
    const p = join(root, 'state', 'qidian-book-cache.json');
    if (!existsSync(p))
        return { version: VERSION, books: {} };
    try {
        const j = JSON.parse(readFileSync(p, 'utf8'));
        if (!j || typeof j !== 'object' || typeof j.books !== 'object' || !j.books)
            return { version: VERSION, books: {} };
        return { version: VERSION, books: j.books };
    }
    catch {
        // 缓存坏了就当没有（不影响业务，也不因此报错）
        return { version: VERSION, books: {} };
    }
}
/** 命中的缓存条目；hit=false 表示「没有或已过期，需要重新请求」 */
export function cachedBook(root, bid, ttlMs) {
    const e = load(root).books[String(bid)];
    if (!e || !e.fetchedAt)
        return { hit: false, hitAt: null, stat: null };
    const at = Date.parse(e.fetchedAt);
    if (!Number.isFinite(at) || Date.now() - at > ttlMs)
        return { hit: false, hitAt: e.fetchedAt, stat: null };
    return { hit: true, hitAt: e.fetchedAt, stat: e };
}
/** 写入一批（原子写：tmp + rename）；只接受拿到 collect 的条目 */
export function putCachedBooks(root, entries) {
    const good = entries.filter((e) => e.key && e.collect != null);
    if (!good.length)
        return 0;
    const cur = load(root);
    const now = new Date().toISOString();
    for (const e of good) {
        cur.books[String(e.key)] = {
            collect: e.collect,
            wordsCnt: e.wordsCnt == null ? null : e.wordsCnt,
            title: e.title == null ? null : e.title,
            fetchedAt: now,
        };
    }
    // 只保留最近 MAX_ENTRIES 条（防止无限增长；不需要 LRU 这么讲究）
    const keys = Object.keys(cur.books);
    if (keys.length > MAX_ENTRIES) {
        keys
            .sort((a, b) => String(cur.books[b].fetchedAt).localeCompare(String(cur.books[a].fetchedAt)))
            .slice(MAX_ENTRIES)
            .forEach((k) => { delete cur.books[k]; });
    }
    const dir = join(root, 'state');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'qidian-book-cache.json');
    const tmp = p + '.tmp';
    writeFileSync(tmp, JSON.stringify({ version: VERSION, books: cur.books }, null, 1) + '\n', 'utf8');
    renameSync(tmp, p);
    return good.length;
}
export function cacheStats(root) {
    const c = load(root);
    const keys = Object.keys(c.books);
    if (!keys.length)
        return { books: 0, newest: null };
    return { books: keys.length, newest: keys.map((k) => c.books[k].fetchedAt).sort().pop() || null };
}
export function clearCache(root) {
    const p = join(root, 'state', 'qidian-book-cache.json');
    if (!existsSync(p))
        return false;
    rmSync(p, { force: true });
    return true;
}
//# sourceMappingURL=qidian-cache.js.map