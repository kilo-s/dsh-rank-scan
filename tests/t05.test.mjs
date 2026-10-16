import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runScan } from '../lib/scan/run.js'
import { MemoryStore } from '../lib/scan/store.js'
import { MissingError } from '../lib/scan/types.js'

const at = (iso) => ({ now: () => new Date(iso) })
const row = (n) => ({ key: 'k' + n, rank: n, value: null, title: 'T' + n, author: null, url: null })
const okBoard = (b, n) => ({ boardId: b, status: 'ok', rows: Array.from({ length: n || 1 }, (_, i) => row(i + 1)), requests: 1, durationMs: 1, warnings: [] })
const site = (id, boards, fn) => ({ id, site: id, metric: 'rank', boards, fetchBoard: fn })

test('熔断：同一站连续失败 3 次后，本站剩余榜标 truncated(site_unhealthy)', async () => {
  const store = new MemoryStore()
  let calls = 0
  const s = site('bad', ['b1', 'b2', 'b3', 'b4', 'b5'], async () => { calls++; throw new MissingError('抓不到') })
  const rec = await runScan({ sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store, maxSiteFailures: 3 })
  /**
   * ★ 2026-10-17（加了失败榜自动重试之后）：熔断计数**跨轮累计**，所以重试那轮一个请求都不发——
   * 这正是想要的行为：站点明显挂了就别再打它（重试只救「偶发抖动」）。
   */
  assert.equal(calls, 3, '熔断后（含自动重试那轮）不应再请求该站')
  assert.ok(rec.warnings.length >= 1, '熔断要有警告')
  const st = Object.fromEntries(rec.boards.map((b) => [b.boardId, b.status]))
  assert.equal(st.b3, 'truncated', '首轮 b3 失败；重试那轮撞上熔断 ⇒ truncated(site_unhealthy)')
  assert.equal(st.b4, 'truncated')
  assert.equal(rec.boards.find((b) => b.boardId === 'b5').reason, 'site_unhealthy')
  assert.ok(rec.warnings.some((w) => w.includes('熔断')))
})

test('重试：只重跑非 ok 的榜，并回当天记录（attempt +1）', async () => {
  const store = new MemoryStore()
  const fetched = []
  let bFails = true
  const s = site('s', ['a', 'b'], async (b) => {
    fetched.push(b)
    if (b === 'b' && bFails) throw new MissingError('第一次失败')
    return okBoard(b)
  })
  const first = await runScan({ sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store })
  assert.equal(first.boards.find((x) => x.boardId === 'b').status, 'missing')
  assert.equal(first.attempt, 1)
  bFails = false
  const second = await runScan({ sites: [s], clock: at('2026-10-14T11:00:00+08:00'), store, retryNonOk: true })
  assert.equal(second.attempt, 2)
  assert.equal(second.boards.find((x) => x.boardId === 'a').status, 'ok')
  assert.equal(second.boards.find((x) => x.boardId === 'b').status, 'ok')
  /**
   * ★ 2026-10-17：本轮的**自动重试**也会再打一次 b（第一次没抓到的榜隔 5 秒重试一次）。
   * 第二次 runScan 走 retryNonOk，只重跑 b（a 已 ok，不该被重跑）。
   */
  assert.deepEqual(fetched, ['a', 'b', 'b', 'b'], 'a 只抓一次；b 抓三次（首轮失败 + 自动重试 + 次日显式重试）')
  assert.ok(first.warnings.some((w) => w.includes('自动重试')), '首轮要记一条自动重试警告')
  assert.equal(store.snapshot('b', '2026-10-14').rows.length, 1)
})

test('重试上限：同一榜每天最多 2 次，超了标 truncated(retry_limit)', async () => {
  const store = new MemoryStore()
  const s = site('s', ['b'], async () => { throw new MissingError('一直失败') })
  const deps = { sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store, retryNonOk: false }
  await runScan(deps)
  await store.bumpRetryCount('b', '2026-10-14')
  await store.bumpRetryCount('b', '2026-10-14')
  const rec = await runScan({ ...deps, retryNonOk: true })
  assert.equal(rec.boards[0].status, 'truncated')
  assert.equal(rec.boards[0].reason, 'retry_limit')
})

test('重试：当天全部 ok 时直接返回，不发请求', async () => {
  const store = new MemoryStore()
  let calls = 0
  const s = site('s', ['a'], async (b) => { calls++; return okBoard(b) })
  await runScan({ sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store })
  const rec = await runScan({ sites: [s], clock: at('2026-10-14T12:00:00+08:00'), store, retryNonOk: true, boards: ['a'] })
  assert.equal(calls, 1)
  assert.ok(rec.warnings.some((w) => w.includes('没有需要重试')))
})

test('看门狗：超过 noProgressMs 没有榜完成 ⇒ aborted_stalled 且不再请求', async () => {
  const store = new MemoryStore()
  let calls = 0
  const start = new Date('2026-10-14T10:00:00+08:00').getTime()
  let n = 0
  const clock = { now: () => new Date(start + 130000 * n++) }
  const s = site('s', ['a', 'b'], async (b) => { calls++; return okBoard(b) })
  const rec = await runScan({ sites: [s], clock, store, maxSiteFailures: 9 })
  assert.equal(calls, 0, '看门狗应先中止，不该发请求')
  assert.equal(rec.outcome, 'aborted_stalled')
  assert.ok(rec.boards.every((b) => b.reason === 'no_progress'))
})

test('取消：外部 signal 立刻生效', async () => {
  const store = new MemoryStore()
  const ac = new AbortController()
  ac.abort()
  const s = site('s', ['a', 'b'], async (b) => okBoard(b))
  const rec = await runScan({ sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store, signal: ac.signal })
  assert.equal(rec.outcome, 'cancelled')
  assert.ok(rec.boards.every((b) => b.status === 'truncated' && b.reason === 'cancelled'))
})

test('取消：扫描中途点停止（轮询标志）⇒ 后续榜不再抓', async () => {
  const store = new MemoryStore()
  const s = site('s', ['a', 'b'], async (b) => {
    if (b === 'a') { store.cancel = true; await new Promise((r) => setTimeout(r, 60)) }
    return okBoard(b)
  })
  const rec = await runScan({ sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store, pollMs: 10 })
  assert.equal(rec.outcome, 'cancelled')
  assert.equal(rec.boards.find((b) => b.boardId === 'a').status, 'ok')
  assert.equal(rec.boards.find((b) => b.boardId === 'b').reason, 'cancelled')
})
test('扫描锁：已有一轮在跑时拒绝启动（返回上一份记录 + 警告）', async () => {
  const store = new MemoryStore()
  const s = site('s', ['a'], async (b) => okBoard(b))
  await runScan({ sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store })
  await store.acquireLock({ startedAt: 'x', heartbeatAt: new Date().toISOString() }, 120000)
  const rec = await runScan({ sites: [s], clock: at('2026-10-14T10:05:00+08:00'), store })
  assert.equal(rec.attempt, 1, '拒绝启动：不应产生新一轮记录')
  assert.ok(rec.warnings.some((w) => w.includes('已有扫描在进行中')))
})

test('扫描锁：心跳过期的残留锁判 crashed 并接管，跑完释放', async () => {
  const store = new MemoryStore()
  await store.acquireLock({ startedAt: 'old', heartbeatAt: new Date(Date.now() - 600000).toISOString() }, 120000)
  const s = site('s', ['a'], async (b) => okBoard(b))
  const rec = await runScan({ sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store })
  assert.equal(rec.outcome, 'completed')
  assert.ok(rec.warnings.some((w) => w.includes('crashed')))
  assert.equal(store.lock, null, '跑完必须释放锁')
})