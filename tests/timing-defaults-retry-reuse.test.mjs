import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 2026-10-30 复核落地的两件事：
//   ① 默认时刻改点（菠萝包 09:30→14:30、起点图 12:40→21:30）
//   ② 失败站冷却后当天补跑 + 跨日版本复用判据
// 解析顺序同 usability-data-*：找不到编译产物就 SKIP（本包只改 src，不替使用者重建 lib/）。
const envLib = process.env.RANK_SCAN_TEST_LIB
const candidates = [
  envLib ? pathToFileURL(envLib.replace(/\\/g, '/') + '/').href : null,
  new URL('../lib/', import.meta.url).href,
].filter(Boolean)
const base = candidates.find((c) => existsSync(join(fileURLToPath(c), 'scan', 'schedule.js')))
if (!base) {
  console.log('SKIP timing-2026-10-30：找不到编译产物（先 npm run build，或设置 RANK_SCAN_TEST_LIB）')
  process.exit(0)
}
const load = (p) => import(new URL(p, base).href)
const sched = await load('scan/schedule.js')
const fresh = await load('scan/freshness.js')

test('默认时刻：菠萝包 14:30、起点图 21:30，其余不变', () => {
  assert.deepEqual(sched.DEFAULT_SITE_TIMES, {
    qidian: '01:30', sfacg: '14:30', fanqie: '08:30', ciweimao: '10:40', qidiantu: '21:30',
  })
  assert.equal(sched.DEFAULT_FALLBACK_TIME, '22:30')
  // 起点图 21:30 必须早于兜底 22:30，否则补跑分支永远拿不到它
  assert.ok(sched.DEFAULT_SITE_TIMES.qidiantu < sched.DEFAULT_FALLBACK_TIME)
})

test('失败站：冷却到点就当天补跑，不必压到 22:30；每站每天仍只补一次', () => {
  const boards = ['qidian.sign.cat4', 'ciweimao.yp_new.week']
  const op = { today: '2026-10-30', boards, siteTimes: { qidian: '01:30', ciweimao: '10:40' }, fallbackTime: '22:30' }
  const done = { siteLastRun: { ciweimao: '2026-10-30' }, ranToday: ['qidian', 'ciweimao'], failed: ['ciweimao'] }
  // 刚失败 10 分钟：还在冷却 ⇒ 不重试（30 秒一次 tick 不能变成无脑重试）
  let p = sched.planSiteRuns({ ...op, ...done, nowHM: '10:50', minutesSinceAttempt: { ciweimao: 10 } })
  assert.deepEqual(p.fallback, [])
  assert.ok(p.done.includes('ciweimao'))
  // 冷却 30 分钟到：立刻进补跑队列（旧行为要等到 22:30）
  p = sched.planSiteRuns({ ...op, ...done, nowHM: '11:10', minutesSinceAttempt: { ciweimao: 30 } })
  assert.deepEqual(p.fallback, ['ciweimao'])
  // 已经补过一次 ⇒ 不再重复
  p = sched.planSiteRuns({ ...op, ...done, nowHM: '11:40', minutesSinceAttempt: { ciweimao: 60 }, retried: { ciweimao: '2026-10-30' } })
  assert.deepEqual(p.fallback, [])
  // 拿不到上次尝试时刻 ⇒ 退回旧行为：到兜底才补
  p = sched.planSiteRuns({ ...op, ...done, nowHM: '11:40' })
  assert.deepEqual(p.fallback, [])
  p = sched.planSiteRuns({ ...op, ...done, nowHM: '22:40' })
  assert.deepEqual(p.fallback, ['ciweimao'])
})

test('疑似未刷新仍按原标题：只到兜底时刻补跑（冷却不适用于这种）', () => {
  const op = { today: '2026-10-30', boards: ['ciweimao.yp_new.week'], siteTimes: { ciweimao: '10:40' }, fallbackTime: '22:30' }
  const p = sched.planSiteRuns({ ...op, nowHM: '12:00', siteLastRun: { ciweimao: '2026-10-30' }, ranToday: ['ciweimao'], stale: ['ciweimao'], minutesSinceAttempt: { ciweimao: 80 } })
  assert.deepEqual(p.fallback, [])
})

const r = (n, extra) => ({ key: 'k' + n, rank: n, value: null, title: 'T' + n, author: null, url: null, extra: extra || {} })
const v1 = [r(1), r(2), r(3)]
const v2 = [r(9), r(8), r(7)]

test('跨日版本复用：今天的名单不同于上一版，但与更早某版逐条相同 ⇒ 判可疑（菠萝包 10-24/25/26 那种）', () => {
  const v = fresh.judgeFreshness({
    boardId: 'sfacg.new.click', date: '2026-10-26', prevDate: '2026-10-25',
    currentRows: v1, previousRows: v2,
    history: [{ date: '2026-10-25', rows: v2 }, { date: '2026-10-24', rows: v1 }],
  })
  assert.equal(v.verdict, 'suspected')
  assert.match(String(v.reason), /2026-10-24/)
})

test('需求②核心场景：本周这版其实=上周那版（跨周同版）⇒ 即使与上一版逐条相同也要判可疑', () => {
  const v = fresh.judgeFreshness({
    boardId: 'sfacg.hot.week', date: '2026-10-26', prevDate: '2026-10-25',
    currentRows: v1, previousRows: v1,
    history: [{ date: '2026-10-25', rows: v1 }, { date: '2026-10-24', rows: v1 }],
  })
  assert.equal(v.verdict, 'suspected', '10-24=10-25=10-26 三天同版必须判出来')
  assert.match(String(v.reason), /2026-10-24/)
  // 同一周内两版相同、历史里也没有跨周同版 ⇒ 仍是正常的「同一期未变化」
  const okSameWeek = fresh.judgeFreshness({
    boardId: 'sfacg.hot.week', date: '2026-10-26', prevDate: '2026-10-25',
    currentRows: v1, previousRows: v1,
    history: [{ date: '2026-10-25', rows: v1 }],
  })
  assert.equal(okSameWeek.verdict, 'ok')
})

test('跨日版本复用：历史里没有同版 ⇒ 正常；周榜同周同版 ⇒ 正常；跨周同版 ⇒ 可疑', () => {
  const ok = fresh.judgeFreshness({
    boardId: 'sfacg.new.click', date: '2026-10-26', prevDate: '2026-10-25',
    currentRows: v1, previousRows: v2,
    history: [{ date: '2026-10-25', rows: v2 }, { date: '2026-10-24', rows: v2 }],
  })
  assert.equal(ok.verdict, 'ok')
  // 周榜：同一周内两版相同是正常形态
  const sameWeek = fresh.judgeFreshness({
    boardId: 'sfacg.hot.week', date: '2026-10-26', prevDate: '2026-10-25',
    currentRows: v1, previousRows: v2,
    history: [{ date: '2026-10-25', rows: v1 }],
  })
  assert.equal(sameWeek.verdict, 'ok')
  // 周榜：上周出现过的版本被复用回来 ⇒ 可疑
  const crossWeek = fresh.judgeFreshness({
    boardId: 'sfacg.hot.week', date: '2026-10-26', prevDate: '2026-10-25',
    currentRows: v1, previousRows: v2,
    history: [{ date: '2026-10-18', rows: v1 }],
  })
  assert.equal(crossWeek.verdict, 'suspected')
})

test('跨日版本复用：期榜同批次不变=正常，跨批复用=可疑（刺猬猫首订约/三江）', () => {
  const rowsA = [r(1, { issue: 478 }), r(2, { issue: 478 })]
  const rowsB = [r(5, { issue: 477 }), r(6, { issue: 477 })]
  const same = fresh.judgeFreshness({
    boardId: 'ciweimao.buy.latest', date: '2026-10-27', prevDate: '2026-10-26',
    currentRows: rowsA, previousRows: rowsB,
    currentPeriodKey: '478', previousPeriodKey: '477',
    history: [{ date: '2026-10-22', rows: rowsA, periodKey: '478' }],
  })
  assert.equal(same.verdict, 'ok')
  const cross = fresh.judgeFreshness({
    boardId: 'ciweimao.buy.latest', date: '2026-10-27', prevDate: '2026-10-26',
    currentRows: rowsA, previousRows: rowsB,
    currentPeriodKey: '478', previousPeriodKey: '477',
    history: [{ date: '2026-10-19', rows: rowsA, periodKey: '477' }],
  })
  assert.equal(cross.verdict, 'suspected')
})
