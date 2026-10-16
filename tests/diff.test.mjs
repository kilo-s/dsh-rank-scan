import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeBoardDiff, daysOnBoard, addDays, guardCrossPeriod, sundayOf } from '../lib/scan/diff.js'

const snap = (date, rows, metric) => ({ boardId: 'b', dataDate: date, metric: metric || 'rank', rows })
const row = (key, rank, value) => ({ key, rank: rank == null ? null : rank, value: value == null ? null : value, title: 'T' + key, author: 'A', url: null })
const hist = (obj) => new Map(Object.entries(obj).map(([k, dates]) => [k, { lastDate: dates[dates.length - 1], dates }]))

test('无基准：firstEver = true，各类为空（不报 0）', () => {
  const d = computeBoardDiff({ boardId: 'b', metric: 'rank', current: snap('2026-10-14', [row('A', 1)]), previous: null })
  assert.equal(d.firstEver, true)
  assert.equal(d.baselineDate, null)
  assert.deepEqual([d.newEntry, d.up, d.down, d.flat, d.out].map((x) => x.length), [0, 0, 0, 0, 0])
})

test('五类 + 新入榜/回榜分开 + 抖动 |Δ|≤2 算持平', () => {
  const prev = snap('2026-10-13', [row('A', 10), row('B', 1), row('C', 5), row('D', 7)])
  const cur = snap('2026-10-14', [row('B', 1), row('A', 3), row('C', 12), row('E', 5), row('F', 6)])
  const d = computeBoardDiff({ boardId: 'b', metric: 'rank', current: cur, previous: prev, history: hist({ F: ['2026-10-10'], A: ['2026-10-13'] }) })
  assert.equal(d.baselineDate, '2026-10-13')
  assert.equal(d.firstEver, false)
  assert.deepEqual(d.up.map((e) => e.key), ['A'])
  assert.equal(d.up[0].delta, 7)
  assert.deepEqual(d.down.map((e) => e.key), ['C'])
  assert.equal(d.down[0].delta, -7)
  assert.deepEqual(d.flat.map((e) => e.key), ['B'])
  assert.deepEqual(d.newEntry.map((e) => e.key), ['E'])
  assert.deepEqual(d.rebound.map((e) => e.key), ['F'])
  assert.deepEqual(d.out.map((e) => e.key), ['D'])
  assert.equal(d.up[0].days, 2, 'A 昨天也在榜 ⇒ 连续 2 天')
  assert.equal(d.flat[0].days, 1, 'B 无历史 ⇒ 1 天')
})

test('抖动：名次变化 1–2 名算持平（并列抖动剔除）', () => {
  const prev = snap('2026-10-13', [row('A', 5)])
  const cur = snap('2026-10-14', [row('A', 3)])
  const d = computeBoardDiff({ boardId: 'b', metric: 'rank', current: cur, previous: prev })
  assert.equal(d.up.length, 0)
  assert.equal(d.flat.length, 1)
  const d2 = computeBoardDiff({ boardId: 'b', metric: 'rank', current: cur, previous: prev, jitter: 0 })
  assert.equal(d2.up.length, 1)
})

test('数值型榜：按指标增量分升降，并给增长量', () => {
  const prev = snap('2026-10-13', [row('A', null, 100), row('B', null, 50)], 'value')
  const cur = snap('2026-10-14', [row('A', null, 130), row('B', null, 40)], 'value')
  const d = computeBoardDiff({ boardId: 'b', metric: 'value', current: cur, previous: prev })
  assert.deepEqual(d.up.map((e) => e.key), ['A'])
  assert.equal(d.up[0].delta, 30)
  assert.deepEqual(d.down.map((e) => e.key), ['B'])
  assert.equal(d.metricDelta[0].delta, 30)
})

test('★ 跨期不可比保护：期键可注入（刺猬猫 issue）；非周期榜永不受影响', () => {
  // 期键不同 ⇒ 跨期
  const g = guardCrossPeriod({
    boardId: 'ciweimao.buy.latest',
    prevDate: '2026-10-15',
    date: '2026-10-16',
    periodKeyOf: (d) => (d === '2026-10-16' ? '478' : '477'),
  })
  assert.equal(g.periodic, true)
  assert.equal(g.crossed, true)
  assert.equal(g.comparable, false)
  assert.equal(g.prevPeriod, '477')
  assert.equal(g.curPeriod, '478')
  // 期键相同 ⇒ 同期，可比
  const same = guardCrossPeriod({ boardId: 'ciweimao.buy.latest', prevDate: '2026-10-15', date: '2026-10-16', periodKeyOf: () => '477' })
  assert.equal(same.crossed, false)
  assert.equal(same.comparable, true)
  // 三江不给 periodKeyOf ⇒ 默认期键 = 本周日
  assert.equal(guardCrossPeriod({ boardId: 'qidiantu.sanjiang', prevDate: '2026-10-10', date: '2026-10-11' }).crossed, true, '周六→周日 ⇒ 换期')
  assert.equal(guardCrossPeriod({ boardId: 'qidiantu.sanjiang', prevDate: '2026-10-14', date: '2026-10-15' }).crossed, false, '同一周内 ⇒ 可比')
  // 非周期榜：即便期键不同也不保护（番茄/起点/菠萝包等照旧环比）
  assert.equal(guardCrossPeriod({ boardId: 'fanqie.m.new.262', prevDate: '2026-10-10', date: '2026-10-11' }).periodic, false)
  assert.equal(guardCrossPeriod({ boardId: 'fanqie.m.new.262', prevDate: '2026-10-10', date: '2026-10-11' }).crossed, false)
  // 本周日算法：2026-10-15 是周四 ⇒ 本周日 2026-10-11；10-11 本身是周日
  assert.equal(sundayOf('2026-10-15'), '2026-10-11')
  assert.equal(sundayOf('2026-10-11'), '2026-10-11')
  assert.equal(sundayOf('2026-10-18'), '2026-10-18')
})

test('★ 跨期不可比：周期榜换期当天的变化列置空（不报跨期假变化）', () => {
  // 三江：周六(10-10) 与 周日(10-11) 分属两期 ⇒ 总增量不可比对
  const prev = snap('2026-10-10', [row('A', 1, 100)], 'value')
  const cur = snap('2026-10-11', [row('A', 1, 30)], 'value')
  const d = computeBoardDiff({ boardId: 'qidiantu.sanjiang', metric: 'value', current: cur, previous: prev })
  assert.equal(d.crossPeriod, true, '跨期要打标记')
  assert.deepEqual(d.up.map((e) => e.key), [], '100 → 30 不能被当成下降')
  assert.deepEqual(d.down.map((e) => e.key), [])
  assert.deepEqual(d.metricDelta, [], '跨期不得产出「增长量」')
  assert.equal(d.flat[0].delta, null, '变化列置空（面板显示「新期」/「—」）')
  // 同一期内 ⇒ 正常相减（保护不许误伤）
  const d2 = computeBoardDiff({ boardId: 'qidiantu.sanjiang', metric: 'value', current: snap('2026-10-15', [row('A', 1, 130)], 'value'), previous: snap('2026-10-14', [row('A', 1, 100)], 'value') })
  assert.equal(d2.crossPeriod, undefined)
  assert.equal(d2.up[0].delta, 30)
  // 刺猬猫首订(约)：期键由调用方注入 issue
  const d3 = computeBoardDiff({
    boardId: 'ciweimao.buy.latest',
    metric: 'value',
    current: snap('2026-10-16', [row('A', null, 20)], 'value'),
    previous: snap('2026-10-15', [row('A', null, 500)], 'value'),
    periodKeyOf: (x) => (x === '2026-10-16' ? '478' : '477'),
  })
  assert.equal(d3.crossPeriod, true)
  assert.equal(d3.flat[0].delta, null)
  // 非周期榜：同样的日期跨度照旧算变化（不受保护影响）
  const d4 = computeBoardDiff({ boardId: 'fanqie.m.new.262', metric: 'value', current: snap('2026-10-11', [row('A', null, 30)], 'value'), previous: snap('2026-10-10', [row('A', null, 100)], 'value') })
  assert.equal(d4.crossPeriod, undefined)
  assert.equal(d4.down[0].delta, -70, '非周期榜跨周日仍照常比较')
})

test('在榜天数：连续计数，断档归零', () => {
  const h = hist({ X: ['2026-10-13', '2026-10-12', '2026-10-10'] })
  assert.equal(daysOnBoard('X', '2026-10-14', h), 3)
  assert.equal(daysOnBoard('Y', '2026-10-14', h), 1)
  assert.equal(addDays('2026-10-01', -1), '2026-09-30')
})
