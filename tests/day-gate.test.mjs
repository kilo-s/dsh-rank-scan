import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

/**
 * ★ 2026-10-17（数据正确性 P0）：按日期直查的**落盘闸门**。
 * 现场：番茄/起点图的榜单页只给「当下」榜面；旧 /day 收到 save:true 就 writeSnapshot，
 * 把今天的榜写成「那天的快照」——不是补数据，是不可回滚的污染。
 * 本测试锁住：内容日期对不上时**一个字节都不写**，且今天仍可正常抓（与日常扫描同义）。
 */
const ROOT = process.cwd()
const tmpDir = () => mkdtempSync(join(ROOT, '.tmp-day-'))

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const TODAY = ymd(new Date())
const PAST = '2026-01-05'
function addDays(s, n) {
  const d = new Date(s + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return ymd(d)
}

/** 假站点：contentDate 模拟「页面上写的日期」，expectFor 模拟适配器的 contentDateFor 能力声明 */
function fakeSite(opts) {
  const o = opts || {}
  const site = {
    id: 'fake',
    site: '假的',
    metric: 'value',
    boards: [o.boardId || 'qidiantu.shouding'],
    async fetchBoard(boardId) {
      if (o.throwMessage) throw new Error(o.throwMessage)
      return {
        boardId,
        status: 'ok',
        rows: [{ key: 'k1', rank: 1, value: 1, title: '书甲', author: '作者甲', url: null }],
        requests: 1,
        durationMs: 1,
        warnings: [],
        contentDate: o.contentDate === undefined ? null : o.contentDate,
      }
    },
  }
  if (o.expectFor) site.contentDateFor = o.expectFor
  return site
}

function harness(dir, site) {
  let handler = null
  const disposers = []
  const ctx = {
    tools: { register() { return () => {} } },
    setInterval() { return { dispose() {} } },
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    webServer: { register(route) { handler = route.handler; return () => { handler = null } } },
    logger: { info() {} },
  }
  apply(ctx, { dataDir: dir, timerFreshMs: 0, qidianCacheTtlDays: 7, sitesFactory: () => [site] })
  assert.ok(handler, '路由没注册上')
  async function call(path, init) {
    let code = 0
    let raw = ''
    const res = { writeHead(c) { code = c }, end(b) { raw = String(b || '') }, setHeader() {} }
    const L = {}
    const req = {
      url: path,
      method: (init && init.method) || 'GET',
      headers: (init && init.headers) || {},
      setEncoding() {},
      on(ev, fn) { (L[ev] || (L[ev] = [])).push(fn); return req },
    }
    const p = handler(req, res)
    const body = init && init.body
    queueMicrotask(() => {
      if (body != null) for (const fn of (L.data || [])) fn(body)
      for (const fn of (L.end || [])) fn()
    })
    await p
    let parsed = null
    try { parsed = JSON.parse(raw) } catch (e) {}
    return { code, body: parsed, raw }
  }
  return { call, cleanup() { for (const d of disposers) { try { d() } catch (e) {} } try { rmSync(dir, { recursive: true, force: true }) } catch (e) {} } }
}
const post = (obj) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })

test('★ /day 写历史日期：站点没声明内容日期能力 ⇒ 409 且不落盘', async () => {
  const dir = tmpDir()
  const h = harness(dir, fakeSite({ contentDate: TODAY }))
  try {
    const r = await h.call('/api/rank-scan/day', post({ boardId: 'qidiantu.shouding', date: PAST, save: true }))
    assert.equal(r.code, 409, '必须拒绝，实际 ' + r.code + ' ' + JSON.stringify(r.body))
    assert.equal(r.body.code, 'unsupported')
    assert.equal(r.body.saved, false)
    assert.equal(existsSync(join(dir, PAST)), false, '不能创建那天的数据目录')
  } finally { h.cleanup() }
})

test('★ /day 写历史日期：页面日期 ≠ 期望 ⇒ 409（就是「今天的数据写到过去日期名下」）', async () => {
  const dir = tmpDir()
  const site = fakeSite({ contentDate: TODAY, expectFor: (b, d) => addDays(d, -1) })
  const h = harness(dir, site)
  try {
    const r = await h.call('/api/rank-scan/day', post({ boardId: 'qidiantu.shouding', date: PAST, save: true }))
    assert.equal(r.code, 409, '实际 ' + r.code + ' ' + JSON.stringify(r.body))
    assert.equal(r.body.code, 'mismatch')
    assert.equal(r.body.contentDate, TODAY)
    assert.equal(r.body.expected, addDays(PAST, -1))
    assert.equal(existsSync(join(dir, PAST)), false, '对不上时不得写任何文件')
  } finally { h.cleanup() }
})

test('★ /day 写历史日期：页面没给日期（无法核对）⇒ 409 unverifiable', async () => {
  const dir = tmpDir()
  const site = fakeSite({ contentDate: null, expectFor: (b, d) => addDays(d, -1) })
  const h = harness(dir, site)
  try {
    const r = await h.call('/api/rank-scan/day', post({ boardId: 'qidiantu.shouding', date: PAST, save: true }))
    assert.equal(r.code, 409)
    assert.equal(r.body.code, 'unverifiable')
    assert.equal(existsSync(join(dir, PAST)), false)
  } finally { h.cleanup() }
})

test('★ /day 直查（不落盘）也要拦：内容日期对不上就不许假装是那天的数据', async () => {
  const dir = tmpDir()
  const site = fakeSite({ contentDate: TODAY, expectFor: (b, d) => addDays(d, -1) })
  const h = harness(dir, site)
  try {
    const r = await h.call('/api/rank-scan/day', post({ boardId: 'qidiantu.shouding', date: PAST, save: false }))
    assert.equal(r.code, 409, '实际 ' + r.code)
    assert.equal(r.body.code, 'mismatch')
    assert.equal(existsSync(join(dir, PAST)), false)
  } finally { h.cleanup() }
})

test('★ /day 写历史日期：页面日期 = 期望（真能回看）⇒ 200 并落盘', async () => {
  const dir = tmpDir()
  const site = fakeSite({ contentDate: null, expectFor: (b, d) => addDays(d, -1) })
  // contentDate 由 fetchBoard 返回：这里改成「页面写的就是期望那天」
  site.fetchBoard = async (boardId) => ({
    boardId: boardId, status: 'ok',
    rows: [{ key: 'k1', rank: 1, value: 1, title: '书甲', author: '作者甲', url: null }],
    requests: 1, durationMs: 1, warnings: [], contentDate: addDays(PAST, -1),
  })
  const h = harness(dir, site)
  try {
    const r = await h.call('/api/rank-scan/day', post({ boardId: 'qidiantu.shouding', date: PAST, save: true }))
    assert.equal(r.code, 200, JSON.stringify(r.body))
    assert.equal(r.body.saved, true)
    assert.equal(r.body.contentDate, addDays(PAST, -1))
    assert.equal(existsSync(join(dir, PAST, 'qidiantu.shouding.json')), true, '可核对时才写快照')
  } finally { h.cleanup() }
})

test('★ /day 写「今天」保持原语义（与日常扫描同义，不要求内容日期能力）', async () => {
  const dir = tmpDir()
  const h = harness(dir, fakeSite({ contentDate: null }))
  try {
    const r = await h.call('/api/rank-scan/day', post({ boardId: 'qidiantu.shouding', date: TODAY, save: true }))
    assert.equal(r.code, 200, JSON.stringify(r.body))
    assert.equal(r.body.saved, true)
    assert.equal(existsSync(join(dir, TODAY, 'qidiantu.shouding.json')), true)
  } finally { h.cleanup() }
})

test('★ /repair rescan 共用同一道闸门（旧的 contentDate 判定形同虚设）', async () => {
  const dir = tmpDir()
  const site = fakeSite({ contentDate: TODAY, expectFor: (b, d) => addDays(d, -1) })
  const h = harness(dir, site)
  try {
    const r = await h.call('/api/rank-scan/repair', post({ mode: 'rescan', boardId: 'qidiantu.shouding', date: PAST }))
    assert.equal(r.code, 409, '实际 ' + r.code + ' ' + JSON.stringify(r.body))
    assert.equal(r.body.code, 'mismatch')
    assert.equal(existsSync(join(dir, PAST)), false)
  } finally { h.cleanup() }
})
