import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { FileStore } from '../lib/scan/store.js'

/**
 * 审计-2 路由级证据（37 越界拒绝 / 38 概览路径）。
 * 与 update-routes.test.mjs 同一个坑：ctx.effect(() => route()) 的返回值是**注销函数**，
 * 假宿主必须把它当 disposer 存起来，不能当场调用。
 */
const ROOT = process.cwd()
const tmpDir = () => mkdtempSync(join(ROOT, '.tmp-a2-'))

function harness(dir) {
  let handler = null
  const disposers = []
  const ctx = {
    tools: { register() { return () => {} } },
    setInterval() { return { dispose() {} } },
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    webServer: { register(route) { handler = route.handler; return () => { handler = null } } },
    logger: { info() {} },
  }
  apply(ctx, { dataDir: dir, timerFreshMs: 0, qidianCacheTtlDays: 7 })
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

test('★ 37：export-file 的 dest 越出用户目录 ⇒ 400（且在动任何文件系统之前就拒）', async () => {
  const dir = tmpDir()
  const h = harness(dir)
  try {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\Temp\\rank-scan-audit2-out' : '/tmp/rank-scan-audit2-out'
    const r = await h.call('/api/rank-scan/bookmark/export-file', post({ format: 'json', dest: outside }))
    assert.equal(r.code, 400, '越界 dest 必须 400（旧实现会直接 mkdirSync+写文件），实际 ' + r.code + ' ' + JSON.stringify(r.body))
    assert.match(String(r.body && r.body.error), /用户目录/, '要说明拒绝原因')
    assert.equal(existsSync(outside), false, '越界路径不得被创建')
  } finally { h.cleanup() }
})

test('★ 37：用户目录本身不是合法导出子目录', async () => {
  const dir = tmpDir()
  const h = harness(dir)
  try {
    const r = await h.call('/api/rank-scan/bookmark/export-file', post({format:'json', dest:homedir()}))
    assert.equal(r.code, 400)
  } finally { h.cleanup() }
})

test('★ 38：/overview 在空数据目录与有数据时都返回 200（改动过 diffFor 的单次读路径）', async () => {
  const dir = tmpDir()
  const h = harness(dir)
  try {
    const empty = await h.call('/api/rank-scan/overview')
    assert.equal(empty.code, 200, '空目录也应 200，实际 ' + empty.code)
    const st = new FileStore(dir)
    st.writeSnapshot({ dataDate: '2026-10-14', boardId: 'qidian.sign.cat12', status: 'ok', rows: [{ key: 'k1', rank: 1, value: 1, title: 'T', author: null, url: null }], requests: 1, durationMs: 1, warnings: [] })
    st.writeScan({ dataDate: '2026-10-14', startedAt: '2026-10-14T02:00:00.000Z', finishedAt: '2026-10-14T02:00:01.000Z', outcome: 'completed', attempt: 1, boards: [{ boardId: 'qidian.sign.cat12', status: 'ok', rows: [], requests: 1, durationMs: 1, warnings: [] }], warnings: [], progress: { done: 1, total: 1 }, budget: {}, heartbeatAt: '2026-10-14T02:00:01.000Z' })
    const withData = await h.call('/api/rank-scan/overview')
    assert.equal(withData.code, 200, '有数据时也应 200，实际 ' + withData.code + ' ' + String(withData.raw).slice(0, 200))
  } finally { h.cleanup() }
})