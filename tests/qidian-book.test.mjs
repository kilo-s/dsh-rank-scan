import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { parseBookPage, makeQidianMobileSite } from '../lib/sites/qidian-mobile.js'
import { runScan } from '../lib/scan/run.js'
import { MemoryStore } from '../lib/scan/store.js'

const here = dirname(fileURLToPath(import.meta.url))
const ctx = () => ({ now: () => new Date(), signal: new AbortController().signal, requestTimeoutMs: 15000 })

test('书页夹具：收藏与精确字数可解析', () => {
  const html = readFileSync(join(here, 'fixtures', 'qidian-book-1049003034.html'), 'utf8')
  const s = parseBookPage(html)
  assert.equal(typeof s.collect, 'number')
  assert.equal(typeof s.wordsCnt, 'number')
  assert.ok(s.collect > 1000, '收藏应为正数')
  assert.ok(s.wordsCnt > 10000, '字数应为正数')
})

test('enrich：逐条补收藏/字数；重试 ≤2 后留 null（不补 0）', async () => {
  const attempts = new Map()
  const site = makeQidianMobileSite({
    boards: ['sign'],
    categories: ['轻小说'],
    rateMinMs: 0,
    maxRetry: 2,
    fetchText: async (url) => {
      const k = (url.match(/\/book\/(\d+)\//) || [])[1] || '?'
      const n = (attempts.get(k) || 0) + 1
      attempts.set(k, n)
      if (k === '2' && n < 3) throw new Error('flaky')
      if (k === '3') throw new Error('always down')
      return '<script>"collect":130053,"wordsCnt":98312</script>'
    },
  })
  const rows = [
    { key: '1', rank: 1, value: null, title: 'A', author: null, url: null },
    { key: '2', rank: 2, value: null, title: 'B', author: null, url: null },
    { key: '3', rank: 3, value: null, title: 'C', author: null, url: null },
  ]
  const res = await site.enrich('board', rows, ctx())
  assert.equal(res.rows[0].extra.collect, 130053)
  assert.equal(res.rows[1].extra.collect, 130053, '重试两次后应成功')
  assert.equal(res.rows[2].extra.collect, null, '一直失败必须留 null 而不是 0')
  assert.equal(res.requests, 7, '请求数 = 1 + 3 + 3')
})

test('runScan(enrich: true)：请求数计入预算，快照带补字段', async () => {
  const site = {
    id: 'fake',
    site: 'fake',
    metric: 'rank',
    boards: ['b'],
    fetchBoard: async (b) => ({
      boardId: b, status: 'ok', requests: 1, durationMs: 1, warnings: [],
      rows: [
        { key: '1', rank: 1, value: null, title: 'A', author: null, url: null },
        { key: '2', rank: 2, value: null, title: 'B', author: null, url: null },
      ],
    }),
    enrich: async (_b, rows) => ({ requests: rows.length, rows: rows.map((r) => ({ ...r, extra: { collect: 42 } })) }),
  }
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock: { now: () => new Date('2026-10-14T10:00:00+08:00') }, store, enrich: true })
  assert.equal(rec.outcome, 'completed')
  assert.equal(rec.boards[0].rows[0].extra.collect, 42)
  assert.equal(store.snapshot('b', '2026-10-14').rows[1].extra.collect, 42)
})

test('runScan(enrich 缺省)：不调用 enrich', async () => {
  let called = false
  const site = {
    id: 'fake', site: 'fake', metric: 'rank', boards: ['b'],
    fetchBoard: async (b) => ({ boardId: b, status: 'ok', requests: 1, durationMs: 1, warnings: [], rows: [{ key: '1', rank: 1, value: null, title: 'A', author: null, url: null }] }),
    enrich: async (_b, rows) => { called = true; return { requests: 1, rows } },
  }
  const store = new MemoryStore()
  await runScan({ sites: [site], clock: { now: () => new Date('2026-10-14T10:00:00+08:00') }, store })
  assert.equal(called, false)
})
