import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

/**
 * ★ 更新路由的**行为**测试：真的 apply() 一个假宿主、真的走 HTTP 处理器，只在网络边界（globalThis.fetch）打桩。
 *
 * ★ 脚手架坑（踩过一次，记下来）：宿主用 `ctx.effect(() => route())` 注册路由，而 `route()` 返回的是
 *   **注销函数**。假宿主若「调用 effect 传进来的函数并执行其返回值」，就会把刚注册的路由当场注销
 *   ⇒ 所有请求都拿不到响应。正确做法：把返回值当 disposer 存起来，只在收尾时调用。
 */
const ROOT = process.cwd()

function harness() {
  const dir = mkdtempSync(join(ROOT, '.tmp-upd-'))
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
    const req = { url: path, method: (init && init.method) || 'GET', headers: (init && init.headers) || {} }
    await handler(req, res)
    let body = null
    try { body = JSON.parse(raw) } catch (e) {}
    return { code, body, raw }
  }
  return { call, dir, cleanup() { for (const d of disposers) { try { d() } catch (e) {} } try { rmSync(dir, { recursive: true, force: true }) } catch (e) {} } }
}

const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj })
const stubFetch = (impl) => {
  const orig = globalThis.fetch
  globalThis.fetch = impl
  return () => { globalThis.fetch = orig }
}

test('★ GET /version：返回本插件版本（读包根 package.json）+ 市场端点提示', async () => {
  const h = harness()
  try {
    const r = await h.call('/api/rank-scan/version')
    assert.equal(r.code, 200)
    assert.equal(r.body.ok, true)
    assert.match(String(r.body.version), /^\d+\.\d+\.\d+/, '要有版本号，实际 ' + r.body.version)
    assert.equal(r.body.name, '@dsh-external/dsh-rank-scan')
    assert.equal(r.body.marketEndpoint, '/dsh-market/api/v1/capabilities')
  } finally { h.cleanup() }
})

test('★ 没装 dsh-market：/update-check 只读降级（200 + 不可点），/update 明确 501', async () => {
  const h = harness()
  const restore = stubFetch(async (url) => {
    if (String(url).includes('/dsh-market/')) return { ok: false, status: 404, json: async () => ({}) }
    if (String(url).includes('registry.npmjs.org')) return jsonRes({ version: '0.2.0' })
    return { ok: false, status: 404, json: async () => ({}) }
  })
  try {
    const r = await h.call('/api/rank-scan/update-check')
    assert.equal(r.code, 200, '查不到提供方不是错误（不能 5xx）')
    assert.equal(r.body.state, 'unavailable')
    assert.equal(r.body.canUpdateInPlace, false, '没市场就绝不能显示可点的就地更新')
    assert.equal(r.body.action, 'manual')
    assert.equal(r.body.latestSource, 'npm', '降级读数来自 npm registry')
    assert.equal(r.body.latest, '0.2.0')
    assert.ok(String(r.body.reason).includes('dsh-market'))
    const u = await h.call('/api/rank-scan/update', { method: 'POST' })
    assert.equal(u.code, 501)
    assert.ok(String(u.body.error).includes('dsh-market'))
  } finally { restore(); h.cleanup() }
})

test('★ 市场可用：用市场版本 ⇒ 可更新；/update 转发并回 operationId；不支持重启时 501', async () => {
  const h = harness()
  const seen = []
  const restore = stubFetch(async (url, init) => {
    const u = String(url)
    seen.push((init && init.method ? init.method + ' ' : 'GET ') + u)
    if (u.includes('/dsh-market/api/v1/capabilities')) {
      return jsonRes({
        schema: 'dsh-market/update-api/v1', apiVersion: '1',
        endpoints: { updates: '/dsh-market/api/v1/updates', operations: '/dsh-market/api/v1/operations', restart: '/dsh-market/api/v1/restart' },
        restart: { supported: false }, features: { update: true },
      })
    }
    if (u.includes('/dsh-market/api/v1/updates?name=')) return jsonRes({ installedVersion: '0.1.0', latestVersion: '0.3.0' })
    if (u.includes('/dsh-market/api/v1/updates')) return jsonRes({ operationId: 'op-123' })
    if (u.includes('registry.npmjs.org')) return jsonRes({ version: '9.9.9' })
    return { ok: false, status: 404, json: async () => ({}) }
  })
  try {
    const r = await h.call('/api/rank-scan/update-check')
    assert.equal(r.code, 200)
    assert.equal(r.body.latestSource, 'market', '有市场就以市场为准（不是 npm 的 9.9.9）')
    assert.equal(r.body.latest, '0.3.0')
    assert.equal(r.body.canUpdateInPlace, true, '市场可用 + 有新版 ⇒ 可点')
    assert.equal(r.body.state, 'update-available')
    const u = await h.call('/api/rank-scan/update', { method: 'POST' })
    assert.equal(u.code, 202, '接受即 202（与市场规范一致）')
    assert.equal(u.body.operationId, 'op-123')
    assert.ok(seen.some((x) => x === 'POST http://127.0.0.1:19387/dsh-market/api/v1/updates'), '必须真的 POST 到市场的 updates 端点：' + JSON.stringify(seen))
    const rs = await h.call('/api/rank-scan/update-restart', { method: 'POST' })
    assert.equal(rs.code, 501, 'restart.supported=false ⇒ 501 让用户自己重启')
    assert.ok(String(rs.body.error).includes('自己重启'))
  } finally { restore(); h.cleanup() }
})

test('★ 跨源请求仍然被拒（新路由同样受票 23 的来源闸保护）', async () => {
  const h = harness()
  try {
    const r = await h.call('/api/rank-scan/version', { headers: { origin: 'http://evil.example', host: '127.0.0.1:19387' } })
    assert.equal(r.code, 403, '新加的 /version 也必须过来源闸')
    const r2 = await h.call('/api/rank-scan/update-check', { headers: { origin: 'http://evil.example', host: '127.0.0.1:19387' } })
    assert.equal(r2.code, 403)
  } finally { h.cleanup() }
})
