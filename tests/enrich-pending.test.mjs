import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runScan } from '../lib/scan/run.js'
import { MemoryStore } from '../lib/scan/store.js'
import { enrichAttemptPolicy, enrichMissingCount } from '../lib/scan/view.js'

/**
 * ★ 2026-10-16（补全持久化）回归。
 *
 * 背景：抓榜是「抓完一榜就 writeSnapshot(裸行)」，补全（进书页、1s/本）在写盘之后才跑。
 * 补全被取消/超时/进程重启打断时，盘上就永久留下裸行 —— 而 enrichIncomplete 只是标记、
 * 全仓库没有一处读它，重启/重载也不补抓不补全 ⇒ 使用者看到「收藏一直空着」。
 * 这里钉住两件事：
 *   ① 补全失败**不影响**榜单落盘（裸行确实会写下去，这是设计，不是 bug）；
 *   ② 这个缺口必须能被 enrichAttemptPolicy 识别成「还该试 / 用尽则放弃」，而不是无声无息。
 */
const clock = { now: () => new Date('2026-10-16T12:00:00+08:00') }

function bareSite(enrichThrows) {
  return {
    id: 'fake',
    site: '假站',
    metric: 'rank',
    boards: ['ciweimao.yp_new.week'],
    async fetchBoard(boardId) {
      return {
        boardId,
        status: 'ok',
        rows: [
          { key: '1', rank: 1, value: null, title: '甲', author: 'A', url: 'https://example.com/1', extra: {} },
          { key: '2', rank: 2, value: null, title: '乙', author: 'B', url: 'https://example.com/2', extra: {} },
        ],
        requests: 1,
        durationMs: 1,
        warnings: [],
      }
    },
    async enrich(_boardId, rows) {
      if (enrichThrows) throw new Error('补全被取消/超时（模拟）')
      return { rows: rows.map((r) => ({ ...r, extra: { ...r.extra, collect: 10, wordsCnt: 20 } })), requests: 2 }
    },
  }
}

test('补全被打断：裸行照样落盘（这是设计），但缺口可被判定为「还要补」', async () => {
  const store = new MemoryStore()
  const rec = await runScan({ sites: [bareSite(true)], clock, store, enrich: true, budget: { maxRequests: 100, maxDurationMs: 60000, noProgressMs: 30000, boardTimeoutMs: 5000, enrichTimeoutMs: 1000, requestTimeoutMs: 5000 } })
  const b = rec.boards[0]
  assert.equal(b.status, 'ok', '补全失败不该把榜判成 missing')
  assert.equal(b.rows.length, 2, '榜单原始行必须保留')
  const snap = store.snapshot('ciweimao.yp_new.week', '2026-10-16')
  assert.equal(snap.rows.length, 2)
  assert.equal(snap.rows[0].extra.collect, undefined, '被打断 ⇒ 盘上是裸行（收藏为空）')
  assert.equal(enrichMissingCount('ciweimao.yp_new.week', snap.rows), 2, '裸行必须能被数出来（供待办/续跑）')
  assert.ok(rec.warnings.some((w) => w.indexOf('补全未完成') >= 0), '要在扫描记录里如实记一条：' + JSON.stringify(rec.warnings))
  // 续跑判定：第一次 ⇒ 该试；次数用尽仍缺 ⇒ 当日放弃（不再无限打站点）
  const tryPol = enrichAttemptPolicy({ pendingDate: '2026-10-16', latestDate: '2026-10-16', missing: 2, tried: 0, maxTries: 3, enrichable: true })
  assert.equal(tryPol.action, 'try')
  const give = enrichAttemptPolicy({ pendingDate: '2026-10-16', latestDate: '2026-10-16', missing: 2, tried: 3, maxTries: 3, enrichable: true })
  assert.equal(give.action, 'giveup')
  // 跨日：昨天的待办不作数（补全只针对最近一个数据日）
  assert.equal(enrichAttemptPolicy({ pendingDate: '2026-10-15', latestDate: '2026-10-16', missing: 2, tried: 0, maxTries: 3, enrichable: true }).action, 'clear')
})

test('补全成功：字段就地写进快照 ⇒ 缺口归零（待办会被清掉）', async () => {
  const store = new MemoryStore()
  await runScan({ sites: [bareSite(false)], clock, store, enrich: true, budget: { maxRequests: 100, maxDurationMs: 60000, noProgressMs: 30000, boardTimeoutMs: 5000, enrichTimeoutMs: 5000, requestTimeoutMs: 5000 } })
  const snap = store.snapshot('ciweimao.yp_new.week', '2026-10-16')
  assert.equal(snap.rows[0].extra.collect, 10)
  assert.equal(snap.rows[0].extra.wordsCnt, 20)
  assert.equal(enrichMissingCount('ciweimao.yp_new.week', snap.rows), 0)
  assert.equal(enrichAttemptPolicy({ pendingDate: '2026-10-16', latestDate: '2026-10-16', missing: 0, tried: 1, maxTries: 3, enrichable: true }).action, 'stale', '已补齐 ⇒ stale（调用方清待办）')
})
