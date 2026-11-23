import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { FileStore } from '../lib/scan/store.js'
import { writeSlim } from '../lib/scan/files.js'

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-watch-trend-'))
  mkdirSync(join(root, 'state'), { recursive: true })
  writeFileSync(join(root, 'state', 'config.json'), JSON.stringify({
    boards: ['qidian.sign.cat12', 'qidiantu.sanjiang', 'fanqie.m.new.261'],
    display: ['qidian.sign.cat12', 'qidiantu.sanjiang', 'fanqie.m.new.261'],
    timerEnabled: false,
    timerSchemaV: 3,
  }))
  const store = new FileStore(root)
  const snap = (dataDate, boardId, metric, rows) => store.writeSnapshot({ boardId, dataDate, metric, rows })
  const initP = Promise.all([
    snap('2026-11-21', 'qidian.sign.cat12', 'rank', [
      { key: '1001', rank: 9, title: '起点上升书', author: '甲', url: 'https://www.qidian.com/book/1001/', value: null, extra: {} },
      { key: '1002', rank: 10, title: '起点退榜书', author: '乙', url: 'https://www.qidian.com/book/1002/', value: null, extra: {} },
    ]),
    snap('2026-11-22', 'qidian.sign.cat12', 'rank', [
      { key: '1001', rank: 6, title: '起点上升书', author: '甲', url: 'https://www.qidian.com/book/1001/', value: null, extra: {} },
      { key: '1002', rank: 12, title: '起点退榜书', author: '乙', url: 'https://www.qidian.com/book/1002/', value: null, extra: {} },
    ]),
    snap('2026-11-23', 'qidian.sign.cat12', 'rank', [
      { key: '1001', rank: 2, title: '起点上升书', author: '甲', url: 'https://www.qidian.com/book/1001/', value: null, extra: {} },
    ]),
    snap('2026-11-22', 'fanqie.m.new.261', 'value', [
      { key: '7001', rank: 3, title: '番茄在读书', author: '丙', url: 'https://fanqienovel.com/page/7001', value: 150000, extra: { read: 150000 } },
    ]),
    snap('2026-11-23', 'fanqie.m.new.261', 'value', [
      { key: '7001', rank: 1, title: '番茄在读书', author: '丙', url: 'https://fanqienovel.com/page/7001', value: 175000, extra: { read: 175000 } },
    ]),
  ])
  writeSlim(root, { dataDate: '2026-11-21-qidian', boards: { 'qidian.sign.cat12': [{ key: '1001', rank: 9, metric: null }, { key: '1002', rank: 10, metric: null }] } })
  writeSlim(root, { dataDate: '2026-11-22-qidian', boards: { 'qidian.sign.cat12': [{ key: '1001', rank: 6, metric: null }, { key: '1002', rank: 12, metric: null }] } })
  writeSlim(root, { dataDate: '2026-11-23-qidian', boards: { 'qidian.sign.cat12': [{ key: '1001', rank: 2, metric: null }] } })
  writeSlim(root, { dataDate: '2026-11-23-qidiantu', boards: { 'qidiantu.sanjiang': [{ key: '1001', rank: 4, metric: 3200 }] } })
  writeSlim(root, { dataDate: '2026-11-22-fanqie', boards: { 'fanqie.m.new.261': [{ key: '7001', rank: 3, metric: 150000 }] } })
  writeSlim(root, { dataDate: '2026-11-23-fanqie', boards: { 'fanqie.m.new.261': [{ key: '7001', rank: 1, metric: 175000 }] } })

  writeFileSync(join(root, 'state', 'bookmarks.json'), JSON.stringify({
    bookmarksVersion: 1,
    savedAt: '2026-11-23T00:00:00Z',
    bookmarks: [
      {
        bookKey: 'qidian:1002', site: 'qidian', url: 'https://www.qidian.com/book/1002/', source: 'board',
        firstSeen: { boardId: 'qidian.sign.cat12', rank: 10, dataDate: '2026-11-21' },
        seenBoards: [{ boardId: 'qidian.sign.cat12', rank: 10, dataDate: '2026-11-21' }],
        title: '起点退榜书', author: '乙', words: 120000, metric: null, metricBoard: 'qidian.sign.cat12',
        capturedAt: '2026-11-22T04:00:00Z', valueFrom: 'snapshot', note: '保留我的拆书笔记', folders: ['追更'], watched: true,
        createdAt: '2026-11-21T00:00:00Z', updatedAt: '2026-11-22T00:00:00Z',
      },
      {
        bookKey: 'qidian:9999', site: 'qidian', url: 'https://www.qidian.com/book/9999/', source: 'manual',
        firstSeen: null, seenBoards: [], title: '早已下榜的老书', author: '老', words: 500000, metric: null, metricBoard: null,
        capturedAt: '2026-10-01T00:00:00Z', valueFrom: 'manual', note: '老笔记', folders: [], watched: true,
        createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      },
    ],
  }))

  let handler
  const disposers = []
  apply({
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    setInterval() { return { dispose() {} } },
    webServer: { register(route) { handler = route.handler; return () => {} } },
    logger: { info() {} },
  }, { dataDir: root, timerFreshMs: 0, sitesFactory: () => [] })

  async function call(url, body) {
    await initP
    const listeners = {}
    let code = 0
    let raw = ''
    const req = {
      url, method: body === undefined ? 'GET' : 'POST',
      headers: { host: '127.0.0.1:19387', 'content-type': 'application/json' },
      setEncoding() {},
      on(k, f) { (listeners[k] ||= []).push(f); return req },
    }
    const p = handler(req, { writeHead(c) { code = c }, setHeader() {}, end(v) { raw = String(v || '') } })
    queueMicrotask(() => {
      if (body !== undefined) for (const f of listeners.data || []) f(JSON.stringify(body))
      for (const f of listeners.end || []) f()
    })
    await p
    return { code, body: JSON.parse(raw) }
  }
  return { root, call, cleanup() { for (const d of disposers) d(); rmSync(root, { recursive: true, force: true }) } }
}

test('/changes 透传书号 key、名次 rank、前名次 prevRank、url 与 author', async () => {
  const h = harness()
  try {
    const r = await h.call('/api/rank-scan/changes')
    assert.equal(r.code, 200)
    const allItems = r.body.sites.flatMap((s) => s.groups.flatMap((g) => g.items))
    const up = allItems.find((x) => x.key === '1001')
    assert.ok(up, '应透传书号 key')
    assert.equal(up.rank, 2)
    assert.equal(up.prevRank, 6)
    assert.equal(up.author, '甲')
    assert.equal(up.url, 'https://www.qidian.com/book/1001/')
  } finally { h.cleanup() }
})

test('GET /book-trend 纯本地读按站 slim 算出多日曲线，并合并起点与起点图历史', async () => {
  const h = harness()
  try {
    const qd = await h.call('/api/rank-scan/book-trend?bookKey=qidian%3A1001&days=7')
    assert.equal(qd.code, 200)
    assert.equal(qd.body.ok, true)
    assert.equal(qd.body.boardId, 'qidian.sign.cat12')
    assert.deepEqual(qd.body.values, [9, 6, 2])
    assert.equal(qd.body.invert, true)
    assert.ok(qd.body.boards.some((b) => b.boardId === 'qidiantu.sanjiang'), '起点与起点图同书号记录应一并发现')

    const fq = await h.call('/api/rank-scan/book-trend?bookKey=fanqie%3A7001&days=7')
    assert.equal(fq.code, 200)
    assert.equal(fq.body.metricKind, 'value')
    assert.equal(fq.body.invert, false)
    assert.deepEqual(fq.body.values, [null, 150000, 175000])
  } finally { h.cleanup() }
})

test('POST /bookmark action=watch 不破坏已有备注/夹，且未加书签可自动建签并进 /watch-summary', async () => {
  const h = harness()
  try {
    // 对未收藏的番茄书点「＋盯盘」⇒ 自动建签并设 watched=true
    const addW = await h.call('/api/rank-scan/bookmark', { action: 'watch', bookKey: 'fanqie:7001', watched: true, boardId: 'fanqie.m.new.261' })
    assert.equal(addW.code, 200)
    assert.equal(addW.body.watched, true)

    // 检查 /watch-summary：退榜预警 + 番茄上涨为活跃项；老书自动归为静默
    const ws = await h.call('/api/rank-scan/watch-summary')
    assert.equal(ws.code, 200)
    assert.equal(ws.body.activeCount, 2)
    assert.equal(ws.body.quietCount, 1)
    const outItem = ws.body.items.find((x) => x.bookKey === 'qidian:1002')
    const fqItem = ws.body.items.find((x) => x.bookKey === 'fanqie:7001')
    const oldItem = ws.body.items.find((x) => x.bookKey === 'qidian:9999')
    assert.equal(outItem.deltaType, 'out')
    assert.equal(outItem.quiet, false)
    assert.equal(fqItem.deltaType, 'up')
    assert.match(fqItem.deltaText, /\+2\.5万/)
    assert.equal(oldItem.quiet, true)

    // 取消盯盘保留原书签与笔记
    const offW = await h.call('/api/rank-scan/bookmark', { action: 'watch', bookKey: 'qidian:1002', watched: false })
    assert.equal(offW.code, 200)
    const saved = JSON.parse(readFileSync(join(h.root, 'state', 'bookmarks.json'), 'utf8')).bookmarks.find((b) => b.bookKey === 'qidian:1002')
    assert.equal(saved.note, '保留我的拆书笔记', '取消盯盘绝不许动用户备注')
    assert.deepEqual(saved.folders, ['追更'])
    assert.equal(saved.watched, undefined)
  } finally { h.cleanup() }
})

test('/overview 对今日未采的批次首订榜自动回退展示昨日快照（fromPrevDay=true）且不误报为已采', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-shouding-prev-'))
  mkdirSync(join(root, 'state'), { recursive: true })
  writeFileSync(join(root, 'state', 'config.json'), JSON.stringify({
    boards: ['qidian.sign.cat12', 'qidiantu.shouding'],
    display: ['qidian.sign.cat12', 'qidiantu.shouding'],
    timerEnabled: false,
    timerSchemaV: 3,
  }))
  const store = new FileStore(root)
  await store.writeSnapshot({
    boardId: 'qidiantu.shouding', dataDate: '2026-11-22', metric: 'value',
    rows: [
      { key: '2001', rank: 1, title: '昨日首订头名', author: '作者甲', url: 'https://www.qidian.com/book/2001/', value: 4676, extra: { showDate: '2026-11-21', cat: '都市' } },
    ],
  })
  await store.writeSnapshot({
    boardId: 'qidian.sign.cat12', dataDate: '2026-11-23', metric: 'rank',
    rows: [{ key: '1001', rank: 1, title: '今日签约头名', author: '作者乙', url: 'https://www.qidian.com/book/1001/', value: null, extra: {} }],
  })
  let handler
  const disposers = []
  apply({
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    setInterval() { return { dispose() {} } },
    webServer: { register(route) { handler = route.handler; return () => {} } },
    logger: { info() {} },
  }, { dataDir: root, timerFreshMs: 0, sitesFactory: () => [] })
  try {
    const listeners = {}
    let code = 0, raw = ''
    const req = { url: '/api/rank-scan/overview', method: 'GET', headers: { host: '127.0.0.1:19387' }, setEncoding() {}, on(k, f) { (listeners[k] ||= []).push(f); return req } }
    const p = handler(req, { writeHead(c) { code = c }, setHeader() {}, end(v) { raw = String(v || '') } })
    queueMicrotask(() => { for (const f of listeners.end || []) f() })
    await p
    assert.equal(code, 200)
    const body = JSON.parse(raw)
    const sd = body.sites.flatMap((s) => s.boards).find((b) => b.boardId === 'qidiantu.shouding')
    assert.ok(sd && sd.batch, '今日未采时应自动回退返回昨日首订 batch')
    assert.equal(sd.status, 'missing', '状态仍诚实标记为今日未采，不冒充今天已采')
    assert.equal(sd.batch.fromPrevDay, true)
    assert.equal(sd.batch.freshForHighlights, true)
    assert.equal(sd.batch.key, '2026-11-21')
    assert.equal(sd.batch.items[0].title, '昨日首订头名')
    assert.equal(sd.batch.items[0].value, 4676)
  } finally {
    for (const d of disposers) d()
    rmSync(root, { recursive: true, force: true })
  }
})

test('/overview 刺猬猫按期首订：仅刚换新期时 freshForHighlights=true，同周重复期自动退出精选', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-cw-issue-'))
  mkdirSync(join(root, 'state'), { recursive: true })
  writeFileSync(join(root, 'state', 'config.json'), JSON.stringify({
    boards: ['ciweimao.buy.latest'], display: ['ciweimao.buy.latest'], timerEnabled: false, timerSchemaV: 3,
  }))
  const store = new FileStore(root)
  await store.writeSnapshot({
    boardId: 'ciweimao.buy.latest', dataDate: '2026-11-22', metric: 'value',
    rows: [{ key: '1', rank: 1, title: '同周老期头名', author: '甲', url: '', value: 9800, extra: { issue: 483, buyNumRaw: '9800+' } }],
  })
  await store.writeSnapshot({
    boardId: 'ciweimao.buy.latest', dataDate: '2026-11-23', metric: 'value',
    rows: [{ key: '1', rank: 1, title: '同周老期头名', author: '甲', url: '', value: 9800, extra: { issue: 483, buyNumRaw: '9800+' } }],
  })
  let handler
  const disposers = []
  apply({
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    setInterval() { return { dispose() {} } },
    webServer: { register(route) { handler = route.handler; return () => {} } },
    logger: { info() {} },
  }, { dataDir: root, timerFreshMs: 0, sitesFactory: () => [] })
  try {
    const getOv = async () => {
      const listeners = {}
      let raw = ''
      const req = { url: '/api/rank-scan/overview', method: 'GET', headers: { host: '127.0.0.1:19387' }, setEncoding() {}, on(k, f) { (listeners[k] ||= []).push(f); return req } }
      const p = handler(req, { writeHead() {}, setHeader() {}, end(v) { raw = String(v || '') } })
      queueMicrotask(() => { for (const f of listeners.end || []) f() })
      await p
      return JSON.parse(raw)
    }
    const bSame = (await getOv()).sites.flatMap((s) => s.boards).find((b) => b.boardId === 'ciweimao.buy.latest')
    assert.equal(bSame.batch.freshForHighlights, false, '同周重复第 483 期不应一直霸占精选')
    // 换新期 484 后立刻恢复 freshForHighlights=true
    await store.writeSnapshot({
      boardId: 'ciweimao.buy.latest', dataDate: '2026-11-24', metric: 'value',
      rows: [{ key: '2', rank: 1, title: '新期头名', author: '乙', url: '', value: 5200, extra: { issue: 484, buyNumRaw: '5200+' } }],
    })
    const bNew = (await getOv()).sites.flatMap((s) => s.boards).find((b) => b.boardId === 'ciweimao.buy.latest')
    assert.equal(bNew.batch.freshForHighlights, true, '刚换第 484 期当天应进精选提示')
  } finally {
    for (const d of disposers) d()
    rmSync(root, { recursive: true, force: true })
  }
})

test('/watch-summary 今日未采的榜不误报红色退榜，/book-trend 从首订点进时优先展连续榜曲线', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-audit-'))
  mkdirSync(join(root, 'state'), { recursive: true })
  writeFileSync(join(root, 'state', 'config.json'), JSON.stringify({
    boards: ['qidian.sign.cat4', 'qidiantu.shouding', 'sfacg.vip.week'],
    display: ['qidian.sign.cat4', 'qidiantu.shouding', 'sfacg.vip.week'],
    timerEnabled: false, timerSchemaV: 3,
  }))
  const store = new FileStore(root)
  // 22 日三榜都有，23 日仅起点签约已采，菠萝包尚未采集
  await store.writeSnapshot({
    boardId: 'sfacg.vip.week', dataDate: '2026-11-22', metric: 'rank',
    rows: [{ key: 'sf1', rank: 5, title: '菠萝包盯盘书', author: '作者S', url: '', value: null, extra: {} }],
  })
  await store.writeSnapshot({
    boardId: 'qidian.sign.cat4', dataDate: '2026-11-22', metric: 'rank',
    rows: [{ key: 'qd1', rank: 9, title: '起点双榜书', author: '作者Q', url: '', value: null, extra: {} }],
  })
  await store.writeSnapshot({
    boardId: 'qidiantu.shouding', dataDate: '2026-11-22', metric: 'value',
    rows: [{ key: 'qd1', rank: 1, title: '起点双榜书', author: '作者Q', url: '', value: 3200, extra: { showDate: '2026-11-21' } }],
  })
  await store.writeSnapshot({
    boardId: 'qidian.sign.cat4', dataDate: '2026-11-23', metric: 'rank',
    rows: [{ key: 'qd1', rank: 4, title: '起点双榜书', author: '作者Q', url: '', value: null, extra: {} }],
  })
  let handler
  const disposers = []
  apply({
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    setInterval() { return { dispose() {} } },
    webServer: { register(route) { handler = route.handler; return () => {} } },
    logger: { info() {} },
  }, { dataDir: root, timerFreshMs: 0, sitesFactory: () => [] })
  const reqJson = async (url, method = 'GET', body) => {
    const listeners = {}
    let code = 0, raw = ''
    const req = { url, method, headers: { host: '127.0.0.1:19387' }, setEncoding() {}, on(k, f) { (listeners[k] ||= []).push(f); return req } }
    const p = handler(req, { writeHead(c) { code = c }, setHeader() {}, end(v) { raw = String(v || '') } })
    queueMicrotask(() => {
      if (body !== undefined) for (const f of listeners.data || []) f(JSON.stringify(body))
      for (const f of listeners.end || []) f()
    })
    await p
    return { code, body: JSON.parse(raw) }
  }
  try {
    // 加入盯盘：sfacg:sf1 今日未采，不应报 deltaType='out'
    const wAdd = await reqJson('/api/rank-scan/bookmark', 'POST', { action: 'watch', bookKey: 'sfacg:sf1', watched: true, boardId: 'sfacg.vip.week' })
    assert.equal(wAdd.code, 200)
    const ws = await reqJson('/api/rank-scan/watch-summary')
    const sfItem = ws.body.items.find((x) => x.bookKey === 'sfacg:sf1')
    assert.ok(sfItem)
    assert.equal(sfItem.deltaType, 'flat', '当日尚未采集的榜不得误报红色退榜')
    assert.equal(sfItem.deltaText, '待采集')
    assert.equal(sfItem.rank, 5)
    // 从首订批次榜点进走势，因该书在签约榜有 2 天连续记录，应优先切到连续签约榜
    const tr = await reqJson('/api/rank-scan/book-trend?bookKey=qidian%3Aqd1&boardId=qidiantu.shouding&days=7')
    assert.equal(tr.code, 200)
    assert.equal(tr.body.boardId, 'qidian.sign.cat4', '应优先展示多日连续签约榜而非单日首订点')
    assert.deepEqual(tr.body.values, [9, 4])
  } finally {
    for (const d of disposers) d()
    rmSync(root, { recursive: true, force: true })
  }
})
