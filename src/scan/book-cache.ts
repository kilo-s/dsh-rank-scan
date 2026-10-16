import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 通用**书页缓存**（2026-10-17）。
 *
 * 为什么需要它：补全是「逐本进书页取站上不给的字段」，而 1s/请求 的采集纪律不可协商 ⇒
 * 一个站 30 本就要 30 秒，19 个榜 ~91 本要 5 分钟。实测：每日榜单里 **88% 的书昨天也出现过**
 * （2026-10-17：366 个唯一书号，323 个是旧的）⇒ 跨天复用才是省请求的大头。
 * 起点早有这套（scan/qidian-cache.ts，7 天 TTL）；这个模块把它**推广到刺猬猫/菠萝包/番茄**。
 *
 * 纪律（与起点缓存一致）：
 * - 键 = `site:bookId`（站内书号，不用 URL —— URL 形态会变）；
 * - **只缓存真取到的值**，缺失一律 null、绝不补 0；一条都没取到 ⇒ 不写缓存（下次重试）；
 * - 原子写（tmp + rename）；容量上限 2000 条（超了按 fetchedAt 淘汰最旧）。
 */
export interface BookPageEntry {
  collect: number | null
  words: number | null
  title: string | null
  author: string | null
  score: number | null
  readCount: number | null
  fetchedAt: string
}

type CacheFile = { version: number; entries: Record<string, BookPageEntry> }

const VERSION = 1
const MAX_ENTRIES = 2000

function fileOf(root: string): string {
  return join(root, 'state', 'book-page-cache.json')
}

function load(root: string): CacheFile {
  const p = fileOf(root)
  if (!existsSync(p)) return { version: VERSION, entries: {} }
  try {
    const j: any = JSON.parse(readFileSync(p, 'utf8'))
    if (!j || typeof j !== 'object' || typeof j.entries !== 'object' || !j.entries) return { version: VERSION, entries: {} }
    return { version: VERSION, entries: j.entries }
  } catch {
    // 缓存坏了就当没有（不影响业务，也不因此报错）
    return { version: VERSION, entries: {} }
  }
}

function keyOf(site: string, bookId: string): string {
  return String(site) + ':' + String(bookId)
}

/** 命中缓存；`hit=false` = 没有或已过期（ttlMs<=0 视为永不过期，供测试/特殊场景用） */
export function cachedEntry(root: string, site: string, bookId: string, ttlMs: number): { hit: boolean; entry: BookPageEntry | null } {
  const e = load(root).entries[keyOf(site, bookId)]
  if (!e || !e.fetchedAt) return { hit: false, entry: null }
  if (!(ttlMs > 0)) return { hit: true, entry: e }
  const at = Date.parse(e.fetchedAt)
  if (!Number.isFinite(at) || Date.now() - at >= ttlMs) return { hit: false, entry: null }
  return { hit: true, entry: e }
}

function hasValue(e: Omit<BookPageEntry, 'fetchedAt'>): boolean {
  return e.collect != null || e.words != null || (e.title != null && String(e.title).trim() !== '') || e.author != null || e.score != null || e.readCount != null
}

/** 写入一批（原子写）；**只接受至少取到一个字段的条目**，返回写入条数 */
export function putEntries(root: string, list: { site: string; bookId: string; entry: Omit<BookPageEntry, 'fetchedAt'> }[]): number {
  const good = (list || []).filter((x) => x && x.bookId && x.site && hasValue(x.entry))
  if (!good.length) return 0
  const cur = load(root)
  const now = new Date().toISOString()
  for (const x of good) {
    const k = keyOf(x.site, x.bookId)
    const prev = cur.entries[k]
    // 合并而不是覆盖：本次没取到的字段保留上一次的值（例如这次只补到字数、上次有收藏）
    cur.entries[k] = {
      collect: x.entry.collect != null ? x.entry.collect : (prev ? prev.collect : null),
      words: x.entry.words != null ? x.entry.words : (prev ? prev.words : null),
      title: x.entry.title != null && String(x.entry.title).trim() !== '' ? x.entry.title : (prev ? prev.title : null),
      author: x.entry.author != null && String(x.entry.author).trim() !== '' ? x.entry.author : (prev ? prev.author : null),
      score: x.entry.score != null ? x.entry.score : (prev ? prev.score : null),
      readCount: x.entry.readCount != null ? x.entry.readCount : (prev ? prev.readCount : null),
      fetchedAt: now,
    }
  }
  const keys = Object.keys(cur.entries)
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => String(cur.entries[b].fetchedAt).localeCompare(String(cur.entries[a].fetchedAt)))
      .slice(MAX_ENTRIES)
      .forEach((k) => { delete cur.entries[k] })
  }
  const dir = join(root, 'state')
  mkdirSync(dir, { recursive: true })
  const p = fileOf(root)
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify({ version: VERSION, entries: cur.entries }, null, 1) + '\n', 'utf8')
  renameSync(tmp, p)
  return good.length
}

export function cacheStats(root: string): { entries: number; newest: string | null } {
  const c = load(root)
  const keys = Object.keys(c.entries)
  if (!keys.length) return { entries: 0, newest: null }
  return { entries: keys.length, newest: keys.map((k) => c.entries[k].fetchedAt).sort().pop() || null }
}

export function clearCache(root: string): boolean {
  const p = fileOf(root)
  if (!existsSync(p)) return false
  rmSync(p, { force: true })
  return true
}
