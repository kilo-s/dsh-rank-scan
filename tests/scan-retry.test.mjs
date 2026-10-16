import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runScan } from '../lib/scan/run.js'
import { MemoryStore } from '../lib/scan/store.js'
import { MissingError } from '../lib/scan/types.js'

/**
 * ★ 2026-10-17（失败榜自动重试）：一次网络抖动不该把整个榜判成 missing 一整天。
 * 实测 2026-10-17 凌晨那次手动扫描：19 个榜里挂了 4 个，全都是 5~7 秒内 failure 的
 * transient fetch failed（刺猬猫两榜、番茄都市脑洞）—— 站点其实是好的，只是那一下没连上。
 * 口径：**失败榜最多自动重试一次**（隔 retryDelayMs，默认 5s），成功的榜不重抓。
 */
const at = (iso) => ({ now: () => new Date(iso) })
const row = (n) => ({ key: 'k' + n, rank: n, value: null, title: 'T' + n, author: null, url: null })
const okBoard = (b, n = 1) => ({ boardId: b, status: 'ok', rows: Array.from({ length: n }, (_, i) => row(i + 1)), requests: 1, durationMs: 1, warnings: [] })
const site = (id, boards, fn) => ({ id, site: id, metric: 'rank', boards, fetchBoard: fn })

test('抖动恢复：第一次 fetch failed 的榜自动重试后转 ok，且落快照', async () => {
  const store = new MemoryStore()
  const calls = []
  let attempts = 0
  const s = site('s', ['a', 'b'], async (b) => {
    calls.push(b)
    if (b === 'b') { attempts += 1; if (attempts === 1) throw new MissingError('fetch failed（模拟瞬时抖动）') }
    return okBoard(b)
  })
  const rec = await runScan({ sites: [s], clock: at('2026-10-17T00:30:00+08:00'), store, retryDelayMs: 0 })
  assert.deepEqual(calls, ['a', 'b', 'b'], 'a 抓一次；b 首轮失败 + 自动重试一次')
  assert.equal(rec.boards.find((x) => x.boardId === 'b').status, 'ok', '重试成功后该榜必须是 ok')
  assert.ok(store.snapshot('b', '2026-10-17'), '重试成功也要落快照（否则面板还是空）')
  assert.equal(store.snapshot('b', '2026-10-17').rows.length, 1)
  assert.ok(rec.warnings.some((w) => w.includes('自动重试')), '要如实记一条自动重试警告：' + JSON.stringify(rec.warnings))
  assert.ok(rec.warnings.some((w) => w.includes('自动重试成功')), '成功了要说清救回了哪个榜')
})

test('不放过真挂的站：两轮都失败 ⇒ 仍判 missing，且只重试一次', async () => {
  const store = new MemoryStore()
  let calls = 0
  const s = site('s', ['b'], async () => { calls += 1; throw new MissingError('一直失败') })
  const rec = await runScan({ sites: [s], clock: at('2026-10-17T00:30:00+08:00'), store, retryDelayMs: 0 })
  assert.equal(calls, 2, '首轮 + 自动重试一轮 = 2 次，不能无限重试')
  assert.equal(rec.boards[0].status, 'missing')
  assert.ok(rec.warnings.some((w) => w.includes('仍有')), '要如实说「重试后仍没抓到」')
})

test('成功的榜不因重试被重抓（只有非 ok 的进重试名单）', async () => {
  const store = new MemoryStore()
  const calls = []
  const s = site('s', ['a', 'b'], async (b) => { calls.push(b); if (b === 'b') throw new MissingError('x'); return okBoard(b) })
  await runScan({ sites: [s], clock: at('2026-10-17T00:30:00+08:00'), store, retryDelayMs: 0 })
  assert.equal(calls.filter((x) => x === 'a').length, 1, 'a 已 ok ⇒ 不该被重试名单带上')
  assert.equal(calls.filter((x) => x === 'b').length, 2, 'b 失败 ⇒ 重试一次')
})

test('站点熔断优先：连续失败到阈值后，自动重试那轮一个请求都不发', async () => {
  const store = new MemoryStore()
  let calls = 0
  const s = site('bad', ['b1', 'b2', 'b3', 'b4'], async () => { calls += 1; throw new MissingError('挂了') })
  const rec = await runScan({ sites: [s], clock: at('2026-10-17T00:30:00+08:00'), store, maxSiteFailures: 2, retryDelayMs: 0 })
  assert.equal(calls, 2, '阈值 2 ⇒ 只打 2 次，重试那轮被熔断挡住')
  const st = Object.fromEntries(rec.boards.map((b) => [b.boardId, b.status]))
  assert.equal(st.b3, 'truncated')
  assert.equal(st.b4, 'truncated')
})
