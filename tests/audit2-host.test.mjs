import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runScan } from '../lib/scan/run.js'
import { MemoryStore } from '../lib/scan/store.js'

/**
 * 审计-2（docs/rank-scan/需求确认-审计修复-v1.md）宿主内核回归。
 * 这几条都是「以前会红」的行为：取消标志不复位、重试提前返回残留锁、时间戳按硬编码 +08:00 落盘。
 */
const at = (iso) => ({ now: () => new Date(iso) })
const row = (n) => ({ key: 'k' + n, rank: n, value: null, title: 'T' + n, author: null, url: null })
const okBoard = (b) => ({ boardId: b, status: 'ok', rows: [row(1)], requests: 1, durationMs: 1, warnings: [] })
const site = (id, boards, fn) => ({ id, site: id, metric: 'rank', boards, fetchBoard: fn })

test('★ 35：运行中取消生效，且下一次扫描不受影响（取消标志被复位）', async () => {
  const store = new MemoryStore()
  let n = 0
  const s = site('s', ['a', 'b'], async (b) => {
    if (b === 'a' && n++ === 0) await store.setCancelFlag(true) // 模拟用户在第一榜之后点「停止本次」
    return okBoard(b)
  })
  const r1 = await runScan({ sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store, pollMs: 10 })
  assert.equal(r1.outcome, 'cancelled', '取消应在下一个榜被观察到')
  const r2 = await runScan({ sites: [s], clock: at('2026-10-14T11:00:00+08:00'), store, pollMs: 10 })
  assert.equal(r2.outcome, 'completed', '再次扫描不受影响（口径：需求确认-扫榜插件-v1:155）')
  assert.equal(await store.getCancelFlag(), false, '扫描开始时应把取消标志复位')
})

test('★ 35：重试模式「当天全部 ok」提前返回时不得残留扫描锁', async () => {
  const store = new MemoryStore()
  const s = site('s', ['a'], async () => okBoard('a'))
  await runScan({ sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store })
  const r2 = await runScan({ sites: [s], clock: at('2026-10-14T10:05:00+08:00'), store, retryNonOk: true })
  assert.ok(r2.warnings.some((w) => w.includes('没有需要重试的榜')), '应走「全 ok 提前返回」分支')
  assert.equal(store.lock, null, '提前返回不得留下扫描锁')
  const r3 = await runScan({ sites: [s], clock: at('2026-10-14T10:06:00+08:00'), store })
  assert.equal(r3.outcome, 'completed')
  assert.ok(!r3.warnings.some((w) => w.includes('已有扫描在进行中')), '锁没有残留，第三次扫描必须真的开跑')
})

test('★ 42：落盘时间戳是绝对时刻（跨时区正确）', async () => {
  const store = new MemoryStore()
  const s = site('s', ['a'], async () => okBoard('a'))
  const rec = await runScan({ sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store })
  assert.match(rec.startedAt, /Z$/, 'startedAt 应为 ISO(UTC) 绝对时刻，而不是「本地墙钟 + 硬编码 +08:00」')
  assert.match(rec.heartbeatAt, /Z$/, 'heartbeatAt 同样')
  assert.equal(Date.parse(rec.startedAt), Date.parse('2026-10-14T02:00:00.000Z'), '10:00+08:00 == 02:00Z')
})

test('★ 42：心跳不可解析的残留锁必须按 stale 接管，不能永久卡住扫描', async () => {
  const store = new MemoryStore()
  store.lock = { startedAt: 'x', heartbeatAt: 'not-a-date' }
  const s = site('s', ['a'], async () => okBoard('a'))
  const rec = await runScan({ sites: [s], clock: at('2026-10-14T10:00:00+08:00'), store })
  assert.equal(rec.outcome, 'completed')
  assert.ok(!rec.warnings.some((w) => w.includes('已有扫描在进行中')), '坏心跳应判 stale 并接管')
})
