import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
export interface BookStat { collect: number | null; wordsCnt: number | null; title?: string | null; fetchedAt: string }
type CacheFile = { version: number; books: Record<string, BookStat> }

const VERSION = 1
const MAX_ENTRIES = 1000

function load(root: string): CacheFile {
  const p = join(root, 'state', 'qidian-book-cache.json')
  if (!existsSync(p)) return { version: VERSION, books: {} }
  try {
    const j: any = JSON.parse(readFileSync(p, 'utf8'))
    if (!j || typeof j !== 'object' || typeof j.books !== 'object' || !j.books) return { version: VERSION, books: {} }
    return { version: VERSION, books: j.books }
  } catch {
    // 缓存坏了就当没有（不影响业务，也不因此报错）
    return { version: VERSION, books: {} }
  }
}

/** 命中的缓存条目；hit=false 表示「没有或已过期，需要重新请求」 */
export function cachedBook(root: string, bid: string, ttlMs: number): { hit: boolean; hitAt: string | null; stat: BookStat | null } {
  const e = load(root).books[String(bid)]
  if (!e || !e.fetchedAt) return { hit: false, hitAt: null, stat: null }
  const at = Date.parse(e.fetchedAt)
  // ★ 边界用 >=：ttlMs=0 必须在**同一毫秒**内也判过期（用 > 时 age=0 会判命中 ⇒ 该用例在快机器上随机变红）
  if (!Number.isFinite(at) || Date.now() - at >= ttlMs) return { hit: false, hitAt: e.fetchedAt, stat: null }
  return { hit: true, hitAt: e.fetchedAt, stat: e }
}

/** 写入一批（原子写：tmp + rename）；只接受拿到 collect 的条目 */
export function putCachedBooks(root: string, entries: { key: string; collect: number | null; wordsCnt: number | null; title?: string | null }[]): number {
  const good = entries.filter((e) => e.key && e.collect != null)
  if (!good.length) return 0
  const cur = load(root)
  const now = new Date().toISOString()
  for (const e of good) {
    cur.books[String(e.key)] = {
      collect: e.collect,
      wordsCnt: e.wordsCnt == null ? null : e.wordsCnt,
      title: e.title == null ? null : e.title,
      fetchedAt: now,
    }
  }
  // 只保留最近 MAX_ENTRIES 条（防止无限增长；不需要 LRU 这么讲究）
  const keys = Object.keys(cur.books)
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => String(cur.books[b].fetchedAt).localeCompare(String(cur.books[a].fetchedAt)))
      .slice(MAX_ENTRIES)
      .forEach((k) => { delete cur.books[k] })
  }
  const dir = join(root, 'state')
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'qidian-book-cache.json')
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify({ version: VERSION, books: cur.books }, null, 1) + '\n', 'utf8')
  renameSync(tmp, p)
  return good.length
}

export function cacheStats(root: string): { books: number; newest: string | null } {
  const c = load(root)
  const keys = Object.keys(c.books)
  if (!keys.length) return { books: 0, newest: null }
  return { books: keys.length, newest: keys.map((k) => c.books[k].fetchedAt).sort().pop() || null }
}

export function clearCache(root: string): boolean {
  const p = join(root, 'state', 'qidian-book-cache.json')
  if (!existsSync(p)) return false
  rmSync(p, { force: true })
  return true
}
