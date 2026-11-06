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
test('番茄排序项：默认（名次）→ 在读变化 → 名次变化 → 字数，且 readDelta 真按在读差排序（2026-11-06 使用者定）', async () => {
  const b = 'fanqie.m.new.262'
  const h = harness()
  try {
    const store = new FileStore(h.root)
    const row = (key, rank, read, vd) => ({ key, rank, value: read, title: key, author: null, url: null, extra: { read, valueDelta: vd, catId: 262 } })
    await store.writeSnapshot({ boardId: b, dataDate: '2026-10-21', metric: 'value', rows: [
      row('a', 1, 1000, 10),
      row('b', 2, 900, 500),
      row('c', 3, 800, -7),
    ] })
    writeFileSync(join(h.root, 'state/config.json'), JSON.stringify({ boards: [b], display: [b], timerEnabled: false, timerSchemaV: 3 }))
    const plain = await h.call('/api/rank-scan/board?boardId=' + encodeURIComponent(b) + '&date=2026-10-21')
    assert.equal(plain.code, 200, JSON.stringify(plain.body))
    assert.deepEqual(plain.body.sortOptions.map((o) => o.label), ['默认（名次）', '在读变化', '名次变化', '字数'])
    assert.deepEqual(plain.body.sortOptions.map((o) => o.value), ['', 'readDelta', 'delta', 'words'])
    assert.ok(!plain.body.sortOptions.some((o) => o.value === 'read'), '番茄不再提供「在读」排序')
    const byReadDelta = await h.call('/api/rank-scan/board?boardId=' + encodeURIComponent(b) + '&date=2026-10-21&sort=readDelta')
    assert.deepEqual(byReadDelta.body.rows.map((r) => r.key), ['b', 'a', 'c'], '在读变化降序：500 / 10 / -7')
  } finally { h.cleanup() }
})
test('起点/刺猬猫/菠萝包：默认（名次）后面是名次变化，且 sort=delta 真按名次差降序（2026-11-06 使用者定）', async () => {
  const h = harness()
  try {
    const store = new FileStore(h.root)
    const boards = ['qidian.sign.cat12', 'ciweimao.no-vip-click.week', 'sfacg.new.click']
    const prevRows = [
      { key: 'k1', rank: 3, value: 3, title: '甲', author: null, url: null },
      { key: 'k2', rank: 1, value: 1, title: '乙', author: null, url: null },
      { key: 'k3', rank: 2, value: 2, title: '丙', author: null, url: null },
    ]
    const curRows = [
      { key: 'k1', rank: 1, value: 1, title: '甲', author: null, url: null },
      { key: 'k2', rank: 2, value: 2, title: '乙', author: null, url: null },
      { key: 'k3', rank: 3, value: 3, title: '丙', author: null, url: null },
    ]
    for (const b of boards) {
      await store.writeSnapshot({ boardId: b, dataDate: '2026-10-20', metric: 'rank', rows: prevRows })
      await store.writeSnapshot({ boardId: b, dataDate: '2026-10-21', metric: 'rank', rows: curRows })
    }
    writeFileSync(join(h.root, 'state/config.json'), JSON.stringify({ boards, display: boards, timerEnabled: false, timerSchemaV: 3 }))
    for (const b of boards) {
      const plain = await h.call('/api/rank-scan/board?boardId=' + encodeURIComponent(b) + '&date=2026-10-21')
      assert.equal(plain.code, 200, b + ' ' + JSON.stringify(plain.body))
      assert.deepEqual(plain.body.sortOptions.slice(0, 2).map((o) => o.label), ['默认（名次）', '名次变化'], b + ' 默认后面必须是名次变化')
      const sorted = await h.call('/api/rank-scan/board?boardId=' + encodeURIComponent(b) + '&date=2026-10-21&sort=delta')
      assert.deepEqual(sorted.body.rows.map((r) => r.delta), [2, -1, -1], b + ' 名次差口径')
      assert.equal(sorted.body.rows[0].key, 'k1', b + ' 名次变化降序：+2 必须排第一')
    }
    // 批次榜：有快照才能看下拉；它没有「变化」列 ⇒ 这一项必须被末尾的列存在性过滤剔除
    await store.writeSnapshot({ boardId: 'ciweimao.buy.latest', dataDate: '2026-10-21', metric: 'value', rows: [
      { key: 'b1', rank: 1, value: 88, title: '丁', author: null, url: null, extra: { issue: 479 } },
    ] })
    const batch = await h.call('/api/rank-scan/board?boardId=' + encodeURIComponent('ciweimao.buy.latest') + '&date=2026-10-21')
    assert.equal(batch.code, 200, JSON.stringify(batch.body))
    assert.ok(!batch.body.sortOptions.some((o) => o.value === 'delta'), '批次榜没有「变化」列 ⇒ 不该出现名次变化')
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
