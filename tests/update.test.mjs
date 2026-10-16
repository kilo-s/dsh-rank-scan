import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readOwnVersion, probeMarket, fetchNpmLatest, normalizeOperation, buildUpdateView, MARKET_CAPABILITIES } from '../lib/scan/update.js'

/**
 * update.ts = 更新链路里唯一碰网络/文件的薄层。
 * 原则：**失败一律退化成「查不到」**，绝不抛到路由层；探测不到市场就只读降级，不当错误。
 */
const here = dirname(fileURLToPath(import.meta.url))
const libDir = join(here, '..', 'lib')

const okJson = (obj) => async () => ({ ok: true, status: 200, json: async () => obj })
const httpErr = (status) => async () => ({ ok: false, status, json: async () => ({}) })
const boom = (msg) => async () => { throw new Error(msg) }

test('★ 自家版本：__dirname 在 lib/ 时必须回上一层读包根 package.json', () => {
  const v = readOwnVersion(libDir)
  assert.ok(v.version, '要能读到版本（lib/../package.json）')
  assert.match(v.version, /^\d+\.\d+\.\d+/, '版本形如 x.y.z ⇒ 实际 ' + v.version)
  assert.ok(v.name, '包名也要读出来')
  // 读不到时不抛、返回 null（例如目录被打包成别处）
  const none = readOwnVersion(join(libDir, 'no-such-dir'))
  assert.equal(none.version, null)
})

test('探测市场：拿不到 / 非 2xx / 抛异常 ⇒ 一律 null（不是错误）', async () => {
  assert.equal(await probeMarket(httpErr(404), { origin: 'http://127.0.0.1:1' }), null)
  assert.equal(await probeMarket(boom('down'), { origin: 'http://127.0.0.1:1' }), null)
  assert.equal(await probeMarket(async () => null, { origin: 'http://127.0.0.1:1' }), null)
  // 假装返回了非 JSON（json() 抛）也要吞掉
  assert.equal(await probeMarket(async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json') } }), { origin: 'http://x' }), null)
})

test('探测市场：字段正确解析（端点/重启支持/能力位），cookie 原样透传', async () => {
  let seen = null
  const caps = {
    schema: 'dsh-market/update-api/v1',
    apiVersion: '1',
    endpoints: { updates: '/dsh-market/api/v1/updates', operations: '/dsh-market/api/v1/operations', restart: '/dsh-market/api/v1/restart' },
    restart: { supported: false },
    features: { updatesSummary: true, update: true },
  }
  const p = await probeMarket(async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => caps } }, { origin: 'http://127.0.0.1:19387', cookie: 'dsh=s1' })
  assert.ok(seen.url.endsWith(MARKET_CAPABILITIES), '必须打固定能力端点')
  assert.equal(seen.init.headers.Cookie, 'dsh=s1', 'cookie 必须透传（新版宿主对 /dsh-market/* 也做登录校验）')
  assert.equal(p.apiVersion, '1')
  assert.equal(p.endpoints.updates, '/dsh-market/api/v1/updates')
  assert.equal(p.restartSupported, false, '桌面/被监管宿主通常 false ⇒ 面板必须隐藏重启按钮')
  assert.equal(p.canUpdate, true)
  // 只给 schema、没有 apiVersion 时也要认（规范里 schema 是必带字段）
  const p2 = await probeMarket(okJson({ schema: 'dsh-market/update-api/v1', endpoints: { updates: '/u', operations: '/o' } }), { origin: 'http://x' })
  assert.equal(p2.apiVersion, '1')
})

test('查 npm latest：正常 / 404 / 不可达 三种都给出可读原因', async () => {
  const ok = await fetchNpmLatest(okJson({ version: '1.2.3' }), 'some-pkg')
  assert.equal(ok.version, '1.2.3')
  assert.equal(ok.reason, 'ok')
  const nf = await fetchNpmLatest(httpErr(404), 'not-published-yet')
  assert.equal(nf.version, null)
  assert.ok(nf.reason.includes('404'), '要能看出是「还没发布」而不是网络问题：' + nf.reason)
  const down = await fetchNpmLatest(boom('ENOTFOUND'), 'x')
  assert.equal(down.version, null)
  assert.ok(down.reason.includes('不可达'))
  // scoped 包名要转义斜杠，否则 registry 会 404
  let url = null
  await fetchNpmLatest(async (u) => { url = u; return { ok: true, json: async () => ({ version: '1.0.0' }) } }, '@a/b')
  assert.ok(url.includes('%2F'), 'scoped 包名必须转义：' + url)
})

test('操作终态归一化：只认六种状态；字段缺失一律 null（不猜）', () => {
  assert.equal(normalizeOperation(null), null)
  assert.equal(normalizeOperation({ state: 'weird' }), null)
  const s = normalizeOperation({ state: 'succeeded', installedVersion: '0.2.0', refreshRequired: true })
  assert.equal(s.state, 'succeeded')
  assert.equal(s.installedVersion, '0.2.0')
  assert.equal(s.refreshRequired, true)
  assert.equal(s.restartRequired, null, '缺失 ⇒ null（不许默认成 false 让面板以为不用重启）')
  const f = normalizeOperation({ status: 'failed', error: '镜像滞后', retryable: true })
  assert.equal(f.state, 'failed')
  assert.equal(f.message, '镜像滞后', 'error 字段要映射成 message')
})

test('组装面板回答（离线）：市场可用就走市场；市场缺失退化成 npm 只读', () => {
  const market = { apiVersion: '1', endpoints: { updates: '/u', updateOperation: '/o' }, restartSupported: true, canUpdate: true }
  const a = buildUpdateView({ current: '0.1.0', name: 'dsh-rank-scan', market, marketLatest: '0.2.0', npmLatest: '9.9.9' })
  assert.equal(a.state, 'update-available')
  assert.equal(a.latest, '0.2.0', '有市场就以市场为准')
  assert.equal(a.latestSource, 'market')
  assert.equal(a.canUpdateInPlace, true)
  // 市场缺失：npm 版本只用于「显示」，不准就地更新
  const b = buildUpdateView({ current: '0.1.0', name: 'dsh-rank-scan', market: null, npmLatest: '0.2.0' })
  assert.equal(b.state, 'unavailable')
  assert.equal(b.canUpdateInPlace, false)
  assert.equal(b.latestSource, 'npm')
  assert.equal(b.action, 'manual')
  // 两边都查不到：仍然只读、不报错
  const c = buildUpdateView({ current: '0.1.0', name: 'x', market: null, npmLatest: null, npmReason: 'registry 不可达：ENOTFOUND' })
  assert.equal(c.state, 'unavailable')
  assert.equal(c.latest, null)
  assert.ok(c.npmReason.includes('不可达'))
  // ★ 口径（避免面板文案自相矛盾）：没有可更新的提供方时按钮一律是「去下载新版」；
  //   「检查更新」只属于「提供方活着、但这次没拿到版本号」那一种。
  assert.equal(c.buttonLabel, '去下载新版')
})
