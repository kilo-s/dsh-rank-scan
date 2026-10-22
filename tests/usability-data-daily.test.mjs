import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 编译产物解析顺序：显式 RANK_SCAN_TEST_LIB → lib/（正常构建）→ .tmp-usability/lib（本地临时编译）。
// 三者都没有时**跳过**并说明原因：本包只改 src，不允许替使用者重建 lib/；
// 一旦构建过（CI 的 prepare / 本地 npm run build）这里就会真实执行断言。
const envLib = process.env.RANK_SCAN_TEST_LIB
const candidates = [
  envLib ? pathToFileURL(envLib.replace(/\\/g, '/') + '/').href : null,
  new URL('../lib/', import.meta.url).href,
  new URL('../.tmp-usability/lib/', import.meta.url).href,
].filter(Boolean)
const base = candidates.find((c) => existsSync(join(fileURLToPath(c), 'scan', 'daily.js')))
if (!base) {
  console.log('SKIP usability-data-*：找不到编译产物（先 npm run build，或设置 RANK_SCAN_TEST_LIB 指向临时编译目录）')
  process.exit(0)
}
const load = (p) => import(new URL(p, base).href)


const daily = await load('scan/daily.js')

const row = (n, collect) => ({ key: 'k' + n, rank: n, value: null, title: 'T' + n, author: null, url: null, extra: collect == null ? {} : { collect } })
const upd = (boardId, status, over) => ({
  boardId, status, rows: status === 'ok' ? 2 : 0, trusted: over && over.trusted === false ? false : true,
  at: (over && over.at) || '2026-10-22T04:40:00.000Z', by: (over && over.by) || 'timer',
  reason: (over && over.reason) || null, capturedAt: (over && over.capturedAt) || '2026-10-22T04:40:00.000Z',
  contentDate: null, samePeriod: !!(over && over.samePeriod),
})

test('分站扫描只覆盖本批：先 A 失败后 B 成功，A 的失败与原因仍在', () => {
  const first = daily.mergeDayIndex(null, '2026-10-22', [
    upd('qidian.sign.cat12', 'ok'),
    upd('qidian.sign.cat4', 'missing', { reason: 'fetch failed', at: '2026-10-22T00:30:05.000Z' }),
  ], '2026-10-22T00:30:06.000Z')
  assert.equal(first.boards['qidian.sign.cat4'].status, 'missing')
  assert.equal(first.boards['qidian.sign.cat4'].reason, 'fetch failed')

  const second = daily.mergeDayIndex(first, '2026-10-22', [upd('qidiantu.shouding', 'ok')], '2026-10-22T04:40:00.000Z')
  assert.equal(second.boards['qidiantu.shouding'].status, 'ok', '本批成功的榜要进当天索引')
  assert.equal(second.boards['qidian.sign.cat4'].status, 'missing', 'A 站失败不能被 B 站成功冲掉')
  assert.equal(second.boards['qidian.sign.cat4'].reason, 'fetch failed', '失败原因必须保留')
  assert.ok(second.revision > first.revision, '真实变化要推进 revision')
})

test('同一批重复合并无变化时 revision 不前进（前端不会空转重取）', () => {
  const a = daily.mergeDayIndex(null, '2026-10-22', [upd('b1', 'ok')], '2026-10-22T01:00:00.000Z')
  const b = daily.mergeDayIndex(a, '2026-10-22', [upd('b1', 'ok')], '2026-10-22T02:00:00.000Z')
  assert.equal(b.revision, a.revision)
  assert.equal(b.updatedAt, '2026-10-22T02:00:00.000Z', '时间戳仍更新')
})

test('当天成功过、后来又失败：状态报失败，但 lastSuccess 事实保留', () => {
  const ok = daily.mergeDayIndex(null, '2026-10-22', [upd('b1', 'ok', { at: '2026-10-22T00:30:00.000Z' })], '2026-10-22T00:30:00.000Z')
  const bad = daily.mergeDayIndex(ok, '2026-10-22', [upd('b1', 'missing', { reason: 'timeout', at: '2026-10-22T05:00:00.000Z' })], '2026-10-22T05:00:00.000Z')
  assert.equal(bad.boards['b1'].status, 'missing', '最近一次尝试失败要如实报')
  assert.ok(bad.boards['b1'].lastSuccess, '当天更早的成功事实不许丢')
  assert.equal(bad.boards['b1'].lastSuccess.at, '2026-10-22T00:30:00.000Z')
  assert.equal(bad.boards['b1'].lastAttempt.reason, 'timeout')
})

test('不可信内容记 trusted=false 且状态落 stale；同批其它榜不受影响', () => {
  const idx = daily.mergeDayIndex(null, '2026-10-22', [
    upd('sfacg.vip.week', 'ok', { trusted: false, reason: '疑似未刷新' }),
    upd('fanqie.m.new.262', 'ok'),
  ], '2026-10-22T01:00:00.000Z')
  assert.equal(idx.boards['sfacg.vip.week'].status, 'stale')
  assert.equal(idx.boards['sfacg.vip.week'].trusted, false)
  assert.equal(idx.boards['sfacg.vip.week'].lastSuccess, null, '被拒内容不算成功事实')
  assert.equal(idx.boards['fanqie.m.new.262'].status, 'ok')
})

test('同一期未变化打 samePeriod 标记（供前端显示「正常」而不是陈旧）', () => {
  const idx = daily.mergeDayIndex(null, '2026-10-22', [upd('ciweimao.buy.latest', 'ok', { samePeriod: true })], '2026-10-22T02:40:00.000Z')
  assert.equal(idx.boards['ciweimao.buy.latest'].samePeriod, true)
  assert.equal(idx.boards['ciweimao.buy.latest'].status, 'ok')
})

test('slim 按日逐榜合并：单榜重抓不抹掉其它榜', () => {
  const before = { dataDate: '2026-10-22', boards: { a: [{ key: 'x', rank: 1, metric: null }], b: [{ key: 'y', rank: 2, metric: null }] } }
  const merged = daily.mergeSlimBoards(before, '2026-10-22', { c: [{ key: 'z', rank: 3, metric: null }] })
  assert.deepEqual(Object.keys(merged.boards).sort(), ['a', 'b', 'c'])
  const replaced = daily.mergeSlimBoards(merged, '2026-10-22', { a: [{ key: 'x2', rank: 9, metric: null }] })
  assert.equal(replaced.boards.a[0].key, 'x2', '本次跑过的榜要被覆盖')
  assert.ok(replaced.boards.b, '没跑的榜保留')
})

test('slim 合并支持剔除被拒榜（避免污染新入榜/回榜历史）', () => {
  const before = { dataDate: '2026-10-22', boards: { a: [{ key: 'x', rank: 1, metric: null }], b: [{ key: 'y', rank: 2, metric: null }] } }
  const merged = daily.mergeSlimBoards(before, '2026-10-22', {}, ['b'])
  assert.deepEqual(Object.keys(merged.boards), ['a'])
})

test('跨日合并：换到新日期时不继承旧日期的榜（当天的历史只记当天真实跑过的）', () => {
  const d1 = { dataDate: '2026-10-21', boards: { a: [{ key: 'x', rank: 1, metric: null }] } }
  const d2 = daily.mergeSlimBoards(d1, '2026-10-22', { b: [{ key: 'y', rank: 1, metric: null }] })
  assert.equal(d2.dataDate, '2026-10-22')
  assert.deepEqual(Object.keys(d2.boards), ['b'])
})

test('逐榜基准跨过缺日：10-18 缺失时 10-19 的基准是 10-17', () => {
  const dates = ['2026-10-16', '2026-10-17', '2026-10-19']
  const snaps = { '2026-10-16': { rows: [row(1)] }, '2026-10-17': { rows: [row(1)] }, '2026-10-19': { rows: [row(2)] } }
  const prev = daily.previousTrustedDate(dates, '2026-10-19', (d) => snaps[d] || null, () => false)
  assert.equal(prev, '2026-10-17')
})

test('逐榜基准跳过被拒快照（stale 不能当基准）', () => {
  const dates = ['2026-10-20', '2026-10-21', '2026-10-22']
  const snaps = { '2026-10-20': { rows: [row(1)] }, '2026-10-21': { rows: [row(1)] }, '2026-10-22': { rows: [row(2)] } }
  const prev = daily.previousTrustedDate(dates, '2026-10-22', (d) => snaps[d] || null, (d) => d === '2026-10-21')
  assert.equal(prev, '2026-10-20')
})

test('revision 摘要随快照大小/时间或隔离标记变化', () => {
  const a = daily.revisionDigest(1, [{ boardId: 'b', size: 10, mtimeMs: 1000 }], [])
  const same = daily.revisionDigest(1, [{ boardId: 'b', size: 10, mtimeMs: 1000 }], [])
  const changed = daily.revisionDigest(1, [{ boardId: 'b', size: 11, mtimeMs: 1000 }], [])
  const isolated = daily.revisionDigest(1, [{ boardId: 'b', size: 10, mtimeMs: 1000 }], ['b'])
  assert.equal(a, same)
  assert.notEqual(a, changed)
  assert.notEqual(changed, isolated)
})