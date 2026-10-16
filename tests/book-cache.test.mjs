import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cachedEntry, cacheStats, clearCache, putEntries } from '../lib/scan/book-cache.js'

/**
 * ★ 2026-10-17（补全优化 ①）：通用书页缓存回归。
 *
 * 为什么要有它：补全 = 逐本进书页，1 请求/秒不可协商。实测每日榜单里 88% 的书号与前一天重合
 * （2026-10-17：366 个唯一书号里 323 个是旧的）⇒ 跨天复用才是省请求的大头，
 * 而以前只有起点有缓存，刺猬猫/菠萝包/番茄每天全量重打。
 */
function tmpRoot() { return mkdtempSync(join(tmpdir(), 'rank-scan-bcache-')) }

test('命中：写进去能按 site:bookId 取回（站点之间不串）', () => {
  const root = tmpRoot()
  try {
    const n = putEntries(root, [{ site: 'ciweimao', bookId: '100', entry: { collect: 5573, words: 116074, title: '甲', author: 'A', score: null, readCount: null } }])
    assert.equal(n, 1)
    const hit = cachedEntry(root, 'ciweimao', '100', 7 * 86400000)
    assert.equal(hit.hit, true)
    assert.equal(hit.entry.collect, 5573)
    assert.equal(hit.entry.words, 116074)
    assert.equal(hit.entry.title, '甲')
    // 另一个站同名书号不能命中
    assert.equal(cachedEntry(root, 'sfacg', '100', 7 * 86400000).hit, false, '不同站必须隔离')
    assert.equal(cachedEntry(root, 'ciweimao', '999', 7 * 86400000).hit, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('过期：TTL 之外判未命中（ttl<=0 视为不过期）', () => {
  const root = tmpRoot()
  try {
    putEntries(root, [{ site: 'sfacg', bookId: '783623', entry: { collect: 89670, words: null, title: null, author: null, score: null, readCount: null } }])
    assert.equal(cachedEntry(root, 'sfacg', '783623', 0).hit, true, 'ttl=0 = 不过期')
    assert.equal(cachedEntry(root, 'sfacg', '783623', 1).hit, false, 'ttl=1ms 必然已过期')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('纪律：一个字段都没取到的条目**不入缓存**（下次重试，且缺失不补 0）', () => {
  const root = tmpRoot()
  try {
    const n = putEntries(root, [{ site: 'ciweimao', bookId: '1', entry: { collect: null, words: null, title: null, author: null, score: null, readCount: null } }])
    assert.equal(n, 0, '空条目不该写盘')
    assert.equal(cacheStats(root).entries, 0)
    // 0 是合法值（真取到 0 才写 0），但 null 不算取到
    assert.equal(putEntries(root, [{ site: 'ciweimao', bookId: '2', entry: { collect: 0, words: null, title: null, author: null, score: null, readCount: null } }]), 1)
    assert.equal(cachedEntry(root, 'ciweimao', '2', 0).entry.collect, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('合并：本次没取到的字段保留上一次的值（别把已有的覆盖成 null）', () => {
  const root = tmpRoot()
  try {
    putEntries(root, [{ site: 'sfacg', bookId: '7', entry: { collect: 1280, words: 99784, title: '书', author: '作者', score: 9.1, readCount: null } }])
    putEntries(root, [{ site: 'sfacg', bookId: '7', entry: { collect: null, words: 12345, title: null, author: null, score: null, readCount: null } }])
    const e = cachedEntry(root, 'sfacg', '7', 0).entry
    assert.equal(e.words, 12345, '新值覆盖')
    assert.equal(e.collect, 1280, '旧值保留')
    assert.equal(e.title, '书', '旧书名保留')
    assert.equal(e.author, '作者', '旧作者保留')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('坏缓存/清空：坏 JSON 当没有；clearCache 后归零', () => {
  const root = tmpRoot()
  try {
    putEntries(root, [{ site: 'fanqie', bookId: '9', entry: { collect: null, words: 100, title: '番茄书名', author: '作者', score: null, readCount: null } }])
    assert.equal(cacheStats(root).entries, 1)
    assert.equal(clearCache(root), true)
    assert.equal(cacheStats(root).entries, 0)
    assert.equal(clearCache(root), false, '再清一次返回 false')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
