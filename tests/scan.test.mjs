import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runScan } from '../lib/scan/run.js'
import { FileStore, MemoryStore } from '../lib/scan/store.js'
import { LoginRequiredError, MissingError, StaleError } from '../lib/scan/types.js'

const clockAt = (iso) => ({ now: () => new Date(iso) })
const row = (n) => ({ key: 'k' + n, rank: n, value: null, title: 'T' + n, author: 'A', url: 'https://example.com/' + n })
const okBoard = (b, n) => ({ boardId: b, status: 'ok', rows: Array.from({ length: n || 2 }, (_, i) => row(i + 1)), requests: 1, durationMs: 1, warnings: [] })
const okSite = (id, boards) => ({ id, site: id, metric: 'rank', boards, fetchBoard: async (b) => okBoard(b) })
const badSite = (id, boards, err) => ({ id, site: id, metric: 'rank', boards, fetchBoard: async () => { throw err } })

test('五态判定：ok / missing / stale / login_required / truncated', async () => {
  const store = new MemoryStore()
  const sites = [
    okSite('s1', ['ok']),
    badSite('s2', ['missing'], new MissingError('未抓到')),
    badSite('s3', ['stale'], new StaleError('疑似未刷新')),
    badSite('s4', ['login'], new LoginRequiredError('缺 cookie')),
    okSite('s5', ['b1', 'b2']),
  ]
  const rec = await runScan({ sites, clock: clockAt('2026-10-14T01:30:00+08:00'), store, budget: { maxRequests: 4 } })
  const st = Object.fromEntries(rec.boards.map((b) => [b.boardId, b.status]))
  assert.equal(st.ok, 'ok')
  assert.equal(st.missing, 'missing')
  assert.equal(st.stale, 'stale')
  assert.equal(st.login, 'login_required')
  assert.equal(st.b2, 'truncated')
  assert.equal(rec.outcome, 'over_budget')
  assert.equal(rec.boards.find((b) => b.boardId === 'b2').reason, 'over_budget')
})

test('数据日期 = 本地自然日（凌晨 01:30 也算当天）', async () => {
  const store = new MemoryStore()
  const rec = await runScan({ sites: [okSite('s1', ['b'])], clock: clockAt('2026-10-14T01:30:00+08:00'), store })
  assert.equal(rec.dataDate, '2026-10-14')
  assert.ok(rec.startedAt.startsWith('2026-10-14T01:30:00'))
  assert.equal(store.snapshot('b', '2026-10-14').rows.length, 2)
})

test('幂等：同日重跑覆盖，不追加、无残留临时文件', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-'))
  const store = new FileStore(root)
  const clock = clockAt('2026-10-14T02:00:00+08:00')
  const deps = { sites: [okSite('s1', ['b'])], clock, store }
  await runScan(deps)
  const first = readFileSync(join(root, '2026-10-14', 'b.json'), 'utf8')
  await runScan(deps)
  const second = readFileSync(join(root, '2026-10-14', 'b.json'), 'utf8')
  assert.equal(first, second)
  const files = readdirSync(join(root, '2026-10-14')).sort()
  assert.deepEqual(files, ['b.json', 'scan.json'])
})

test('取消：标志生效，未抓的榜标 truncated(cancelled)', async () => {
  const store = new MemoryStore()
  store.cancel = true
  const rec = await runScan({ sites: [okSite('s1', ['a', 'b'])], clock: clockAt('2026-10-14T03:00:00+08:00'), store })
  assert.equal(rec.outcome, 'cancelled')
  assert.ok(rec.boards.every((b) => b.status === 'truncated' && b.reason === 'cancelled'))
})
