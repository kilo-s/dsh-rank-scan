import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheStats, cachedBook, clearCache, putCachedBooks } from '../lib/scan/qidian-cache.js'

const TTL = 7 * 24 * 60 * 60 * 1000
const mk = () => mkdtempSync(join(tmpdir(), 'qcache-'))

test('起点书页缓存：空缓存 ⇒ 未命中', () => {
  const root = mk()
  const r = cachedBook(root, '1049003034', TTL)
  assert.equal(r.hit, false)
  assert.equal(r.stat, null)
  assert.equal(cacheStats(root).books, 0)
})

test('起点书页缓存：写入后可命中，且字段原样保留', () => {
  const root = mk()
  const n = putCachedBooks(root, [{ key: '1049003034', collect: 131219, wordsCnt: 103562, title: '有仙则名' }])
  assert.equal(n, 1)
  const r = cachedBook(root, '1049003034', TTL)
  assert.equal(r.hit, true)
  assert.equal(r.stat.collect, 131219)
  assert.equal(r.stat.wordsCnt, 103562)
  assert.equal(r.stat.title, '有仙则名')
  assert.equal(cacheStats(root).books, 1)
  assert.ok(cacheStats(root).newest)
})

test('★ 拿不到 collect 的结果不入缓存（下次会重试，不把失败固化成空值）', () => {
  const root = mk()
  const n = putCachedBooks(root, [
    { key: 'a', collect: null, wordsCnt: 1 },
    { key: 'b', collect: 5, wordsCnt: null },
  ])
  assert.equal(n, 1, '只有拿到 collect 的那条该被写入')
  assert.equal(cachedBook(root, 'a', TTL).hit, false)
  assert.equal(cachedBook(root, 'b', TTL).hit, true)
})

test('★ TTL 过期 ⇒ 判未命中但保留上次时间（供面板显示）', () => {
  const root = mk()
  putCachedBooks(root, [{ key: 'x', collect: 10, wordsCnt: 20 }])
  assert.equal(cachedBook(root, 'x', TTL).hit, true)
  // TTL=0 ⇒ 立刻过期
  const stale = cachedBook(root, 'x', 0)
  assert.equal(stale.hit, false)
  assert.ok(stale.hitAt, '过期时仍应回上次抓取时间')
})

test('缓存清空：clearCache 返回真值且文件消失', () => {
  const root = mk()
  putCachedBooks(root, [{ key: 'x', collect: 1, wordsCnt: 2 }])
  assert.equal(clearCache(root), true)
  assert.equal(cachedBook(root, 'x', TTL).hit, false)
  assert.equal(clearCache(root), false, '再清一次应报「本来就是空的」')
})

test('缓存文件损坏 ⇒ 当空缓存处理，不抛错', () => {
  const root = mk()
  mkdirSync(join(root, 'state'), { recursive: true })
  writeFileSync(join(root, 'state', 'qidian-book-cache.json'), '{ this is not json', 'utf8')
  const r = cachedBook(root, 'x', TTL)
  assert.equal(r.hit, false)
  assert.equal(cacheStats(root).books, 0)
  // 坏文件存在时仍能正常写入（覆盖）
  assert.equal(putCachedBooks(root, [{ key: 'y', collect: 3, wordsCnt: 4 }]), 1)
  assert.equal(cachedBook(root, 'y', TTL).hit, true)
})

test('缓存容量上限：超过 1000 条时淘汰最旧的，保留最新', () => {
  const root = mk()
  // 先写 600 条并把时间改早，再写 600 条（时间=现在）⇒ 淘汰应落在最早的那批
  putCachedBooks(root, Array.from({ length: 600 }, (_, i) => ({ key: 'old' + i, collect: i + 1, wordsCnt: i })))
  const p = join(root, 'state', 'qidian-book-cache.json')
  const f = JSON.parse(readFileSync(p, 'utf8'))
  const longAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  for (const k of Object.keys(f.books)) f.books[k].fetchedAt = longAgo
  writeFileSync(p, JSON.stringify(f), 'utf8')
  putCachedBooks(root, Array.from({ length: 600 }, (_, i) => ({ key: 'new' + i, collect: i + 1, wordsCnt: i })))

  const s = cacheStats(root)
  assert.equal(s.books, 1000, '应恰好压到上限，实际 ' + s.books)
  assert.equal(cachedBook(root, 'new599', TTL).hit, true, '新的一批应保留')
  assert.equal(cachedBook(root, 'old0', TTL).hit, false, '最旧的一批应被淘汰')
})
