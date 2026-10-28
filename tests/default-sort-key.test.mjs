import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { FileStore } from '../lib/scan/store.js'
import { defaultSortKeyFor } from '../lib/scan/view.js'

function harness(sitesFactory = () => []) {
  const root = mkdtempSync(join(process.cwd(), '.tmp-default-sort-'))
  mkdirSync(join(root, 'state'))
  writeFileSync(join(root, 'state/config.json'), JSON.stringify({ boards: [], display: [], timerEnabled: false, timerSchemaV: 3 }))
  let handler
  const disposers = []
  apply({
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    setInterval() { return { dispose() {} } },
    webServer: { register(route) { handler = route.handler; return () => {} } },
    logger: { info() {} },
  }, { dataDir: root, timerFreshMs: 0, sitesFactory })
  async function call(url, body) {
    const listeners = {}; let code; let raw = ''
    const req = { url, method: body === undefined ? 'GET' : 'POST', headers: { host: '127.0.0.1:19387', 'content-type': 'application/json' }, setEncoding() {}, on(k, f) { (listeners[k] ||= []).push(f); return req } }
    const p = handler(req, { writeHead(c) { code = c }, setHeader() {}, end(v) { raw = String(v || '') } })
    queueMicrotask(() => { if (body !== undefined) for (const f of listeners.data || []) f(JSON.stringify(body)); for (const f of listeners.end || []) f() })
    await p
    return { code, body: JSON.parse(raw) }
  }
  return { root, call, cleanup() { for (const d of disposers) d(); rmSync(root, { recursive: true, force: true }) } }
}

test('defaultSortKeyFor 覆盖普通榜、三江、番茄派生榜', () => {
  assert.deepEqual(defaultSortKeyFor('qidian.sign.cat12'), { key: 'rank', dir: 'ascending' })
  assert.deepEqual(defaultSortKeyFor('qidiantu.sanjiang'), { key: 'collectBase', dir: 'descending' })
  assert.deepEqual(defaultSortKeyFor('fanqie.derived.period'), { key: 'value', dir: 'descending' })
})

test('sort=rank 视同未指定，且 sortOptions 不再包含 rank', async () => {
  const h = harness()
  const b = 'qidian.sign.cat12'
  try {
    const store = new FileStore(h.root)
    // 故意按 rank 2、1 写：若不传 sort 就保持站点顺序；旧逻辑 sort=rank 会倒成 2,1
    await store.writeSnapshot({ boardId: b, dataDate: '2026-10-21', metric: 'value', rows: [
      { key: 'k2', rank: 2, value: 20, title: '第二', author: null, url: null },
      { key: 'k1', rank: 1, value: 10, title: '第一', author: null, url: null },
    ] })
    writeFileSync(join(h.root, 'state/config.json'), JSON.stringify({ boards: [b], display: [b], timerEnabled: false, timerSchemaV: 3 }))
    const plain = await h.call('/api/rank-scan/board?boardId=' + encodeURIComponent(b) + '&date=2026-10-21')
    const rank = await h.call('/api/rank-scan/board?boardId=' + encodeURIComponent(b) + '&date=2026-10-21&sort=rank')
    assert.equal(plain.code, 200, JSON.stringify(plain.body))
    assert.deepEqual(plain.body.rows.map((r) => r.key), ['k2', 'k1'])
    assert.deepEqual(rank.body.rows.map((r) => r.key), plain.body.rows.map((r) => r.key))
    assert.deepEqual(plain.body.defaultSortKey, { key: 'rank', dir: 'ascending' })
    assert.ok(!plain.body.sortOptions.some((o) => o.value === 'rank'), '下拉里不能再出现「名次」排序项')
  } finally { h.cleanup() }
})

test('/day 响应也带 defaultSortKey', async () => {
  const b = 'qidian.sign.cat12'
  const site = { id: 'qidian', site: 'qidian', metric: 'value', boards: [b], contentDateFor: () => '2026-10-21', async fetchBoard() { return { boardId: b, status: 'ok', rows: [{ key: 'k1', rank: 1, value: 10, title: 'Fixture', author: null, url: null }], contentDate: '2026-10-21', requests: 1, durationMs: 1, warnings: [] } } }
  const h = harness(() => [site])
  try {
    const r = await h.call('/api/rank-scan/day', { boardId: b, date: '2026-10-21', save: false })
    assert.equal(r.code, 200, JSON.stringify(r.body))
    assert.deepEqual(r.body.defaultSortKey, { key: 'rank', dir: 'ascending' })
  } finally { h.cleanup() }
})
