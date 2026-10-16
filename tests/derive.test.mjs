import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveFanqieViews, weekStart } from '../lib/scan/derive.js'

/**
 * 番茄派生榜（2026-10-15 定稿）：**自然周**口径 —— 照搬起点图三江榜的
 * 「同一期首日 + 期内累加每日增量 + 已结算 N 天」，默认名次按**今日涨幅**倒序。
 * 两个旧榜（在读涨幅榜 / 七日累计）已合并成一个 fanqie.derived.period。
 */

// 造一个极简快照表：{ date: { boardId: rows } }
function makeReader(table) {
  return (boardId, date) => {
    const rows = table[date] && table[date][boardId]
    return rows ? { boardId, dataDate: date, metric: 'value', rows } : null
  }
}
const row = (key, title, value, rank) => ({ key, rank, value, title, author: 'A' + key, url: 'https://x/' + key, extra: {} })
const viewOf = (views) => views.find((v) => v.boardId === 'fanqie.derived.period')

test('自然周边界：期首永远是周一（2026-10-12 是周一）', () => {
  assert.equal(weekStart('2026-10-12'), '2026-10-12', '周一 → 自己')
  assert.equal(weekStart('2026-10-15'), '2026-10-12', '周四 → 本周一')
  assert.equal(weekStart('2026-10-18'), '2026-10-12', '周日 → 仍属本周')
  assert.equal(weekStart('2026-10-19'), '2026-10-19', '下周一 → 新一期')
})

test('默认名次 = 今日涨幅倒序；期内累计 = 今日 − 期首', () => {
  const table = {
    '2026-10-12': { 'fanqie.m.new.1141': [row('1', '甲', 1000, 1), row('2', '乙', 900, 2)] },
    '2026-10-14': { 'fanqie.m.new.1141': [row('1', '甲', 1300, 2), row('2', '乙', 1500, 1)] },
  }
  const v = viewOf(deriveFanqieViews(makeReader(table), {
    date: '2026-10-14', poolBoards: ['fanqie.m.new.1141'], dataDates: ['2026-10-12', '2026-10-14'],
  }))
  assert.equal(v.periodStart, '2026-10-12')
  assert.equal(v.periodEnd, '2026-10-18')
  assert.equal(v.settledDays, 2)
  // 乙今日 +600 > 甲 +300 ⇒ 名次乙在前（默认按今日涨幅倒序）
  assert.deepEqual(v.rows.map((r) => [r.title, r.rank, r.value]), [['乙', 1, 600], ['甲', 2, 300]])
  // 本期累计 = 今日 − 期首：甲 300、乙 600
  assert.deepEqual(v.rows.map((r) => [r.title, r.extra.periodDelta]), [['乙', 600], ['甲', 300]])
  assert.equal(v.rows[0].extra.baseRead, 900, '期首读数要留着（面板「期初」）')
  assert.equal(v.rows[0].extra.settledDays, 2)
})

test('★ 期首缺快照 ⇒ 期累计退回到「本期内最早有数据的日期」起算（不是 null）', () => {
  // 我们是从 10-14 才开始抓的：本期期首 10-12 没有快照
  const table = {
    '2026-10-14': { 'fanqie.m.new.1141': [row('1', '甲', 1500, 1)] },
    '2026-10-15': { 'fanqie.m.new.1141': [row('1', '甲', 1900, 1)] },
  }
  const v = viewOf(deriveFanqieViews(makeReader(table), {
    date: '2026-10-15', poolBoards: ['fanqie.m.new.1141'], dataDates: ['2026-10-14', '2026-10-15'],
  }))
  assert.equal(v.periodStart, '2026-10-12', '期首仍然是周一')
  assert.equal(v.rows[0].extra.periodDelta, 400, '按 10-14 起算：1900 − 1500')
  assert.equal(v.rows[0].extra.baseDate, '2026-10-14', '基准日被推后要能看出来')
  assert.equal(v.rows[0].extra.baseIsPeriodStart, false)
  assert.ok(String(v.note).includes('期首 2026-10-12 没有快照'), '说明行必须点出基准被推后')
  assert.ok(String(v.note).includes('2026-10-14 起算'))
})

test('★ 今天才入池（期内没有更早的自己）⇒ 期累计 null（不伪造 0）', () => {
  const table = {
    '2026-10-14': { 'fanqie.m.new.1141': [row('1', '甲', 1500, 1)] },
    '2026-10-15': { 'fanqie.m.new.1141': [row('1', '甲', 1900, 1), row('3', '丙', 800, 1)] },
  }
  const v = viewOf(deriveFanqieViews(makeReader(table), {
    date: '2026-10-15', poolBoards: ['fanqie.m.new.1141'], dataDates: ['2026-10-14', '2026-10-15'],
  }))
  const bing = v.rows.find((r) => r.title === '丙')
  assert.equal(bing.value, null, '今天才入池 ⇒ 今日涨幅 null（没有上一数据日）')
  assert.equal(bing.extra.periodDelta, null, '期内没有更早的自己 ⇒ 期累计 null')
  assert.equal(bing.extra.baseDate, null)
  assert.equal(bing.extra.firstInPool, true)
  assert.equal(bing.extra.inPoolDays, 1)
  assert.equal(v.rows[0].title, '甲')
  assert.equal(v.rows[0].extra.periodDelta, 400)
})

test('期首当天（周一就是数据首日）：累计算不出来，但已结算与说明要有', () => {
  const table = { '2026-10-12': { 'fanqie.m.new.1141': [row('1', '甲', 1000, 1)] } }
  const v = viewOf(deriveFanqieViews(makeReader(table), { date: '2026-10-12', poolBoards: ['fanqie.m.new.1141'], dataDates: ['2026-10-12'] }))
  assert.equal(v.settledDays, 1)
  assert.equal(v.rows[0].value, null, '没有上一数据日 ⇒ 今日涨幅 null')
  // 期首就是今天（也是唯一基准）⇒ 期累计 = 今天 − 今天 = 0（「本周内还没涨」是事实，不是缺失）
  assert.equal(v.rows[0].extra.periodDelta, 0, '基准日==今天 ⇒ 期累计 0')
  assert.equal(v.rows[0].extra.baseDate, '2026-10-12')
  assert.equal(v.rows[0].extra.baseIsPeriodStart, true)
  assert.ok(String(v.note).includes('已结算 1/7 天'), '说明行要有结算进度')
  assert.ok(String(v.note).includes('2026-10-12 ~ 2026-10-18'), '说明行要写具体日期范围（不要「周一~周日」）')
})

test('跨周：新一期只有一天时，「今日涨幅」也按期内口径 ⇒ null（不拿上一期的日子当比较基准）', () => {
  const table = {
    '2026-10-18': { 'fanqie.m.new.1141': [row('1', '甲', 1000, 1)] },
    '2026-10-19': { 'fanqie.m.new.1141': [row('1', '甲', 1200, 1)] },
  }
  const v = viewOf(deriveFanqieViews(makeReader(table), {
    date: '2026-10-19', poolBoards: ['fanqie.m.new.1141'], dataDates: ['2026-10-18', '2026-10-19'],
  }))
  assert.equal(v.periodStart, '2026-10-19', '新一期从这天开始（周一）')
  assert.equal(v.settledDays, 1, '本期只结算了今天')
  // ★ 口径选择（2026-10-15）：期的语义是「本周内」，所以「今日涨幅」的比较基准也**落在期内**，
  //   不跨期去取上一期的最后一天。否则周一那天的「本期累计」会是 0 而「今日涨幅」却是 200，
  //   两个数在同一天里互相矛盾。代价：每周一所有书的「今日涨幅」都是「—」（诚实表达"本周还没法算涨幅"）。
  assert.equal(v.rows[0].value, null, '期内没有上一数据日 ⇒ 今日涨幅 null')
  // 新一期期首就是今天 ⇒ 期累计 0（基准=今天）；下周一起就有真实累计了
  assert.equal(v.rows[0].extra.periodDelta, 0, '本期累计：期首就是今天 ⇒ 0')
  assert.equal(v.rows[0].extra.baseDate, '2026-10-19', '基准日 = 新一期期首')
})

test('池子 = 多榜并集去重（同一本书只算一次）', () => {
  const table = {
    '2026-10-12': { a: [row('1', '甲', 100, 1)], b: [row('1', '甲', 100, 5)] },
    '2026-10-14': { a: [row('1', '甲', 400, 1)], b: [row('1', '甲', 400, 5), row('2', '乙', 50, 9)] },
  }
  const v = viewOf(deriveFanqieViews(makeReader(table), { date: '2026-10-14', poolBoards: ['a', 'b'], dataDates: ['2026-10-12', '2026-10-14'] }))
  assert.equal(v.rows.length, 2, '并集只有甲、乙两本')
  assert.equal(v.rows.find((r) => r.title === '甲').value, 300)
  assert.equal(v.rows.find((r) => r.title === '甲').extra.periodDelta, 300)
})

test('只派生一个榜（旧的在读涨幅榜/七日累计已退掉）', () => {
  const table = { '2026-10-12': { 'fanqie.m.new.1141': [row('1', '甲', 100, 1)] } }
  const views = deriveFanqieViews(makeReader(table), { date: '2026-10-12', poolBoards: ['fanqie.m.new.1141'], dataDates: ['2026-10-12'] })
  assert.equal(views.length, 1)
  assert.equal(views[0].boardId, 'fanqie.derived.period')
  assert.ok(!views.some((v) => v.boardId === 'fanqie.derived.delta'))
  assert.ok(!views.some((v) => v.boardId === 'fanqie.derived.week'))
})
test('★ 逐日增量（pdays）：第 N 天 = 第 N 天 − 第 N−1 天；缺一侧 ⇒ null', () => {
  const table = {
    '2026-10-12': { 'fanqie.m.new.1141': [row('1', '甲', 1000, 1)] },
    '2026-10-13': { 'fanqie.m.new.1141': [row('1', '甲', 1200, 1)] },
    '2026-10-14': { 'fanqie.m.new.1141': [row('1', '甲', 1500, 1)] },
    '2026-10-15': { 'fanqie.m.new.1141': [row('1', '甲', 1900, 1)] },
  }
  const v = viewOf(deriveFanqieViews(makeReader(table), {
    date: '2026-10-15', poolBoards: ['fanqie.m.new.1141'], dataDates: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'],
  }))
  // 期首(第1天)=10-12 是基准 ⇒ 第1天恒为 null；第2~4天分别是 200 / 300 / 400；第5~7天未到
  assert.deepEqual(v.rows[0].extra.pdays, [null, 200, 300, 400, null, null, null])
  assert.equal(v.rows[0].value, 400, '今日涨幅 = 1900 − 1500')
  assert.equal(v.rows[0].extra.periodDelta, 900, '期累计 = 1900 − 1000')
})

test('★ 逐日增量：中间缺一天 ⇒ 那一天和它的下一天都算不出来（不许跨越缺口）', () => {
  const table = {
    '2026-10-12': { 'fanqie.m.new.1141': [row('1', '甲', 1000, 1)] },
    // 10-13 缺快照
    '2026-10-14': { 'fanqie.m.new.1141': [row('1', '甲', 1500, 1)] },
    '2026-10-15': { 'fanqie.m.new.1141': [row('1', '甲', 1900, 1)] },
  }
  const v = viewOf(deriveFanqieViews(makeReader(table), {
    date: '2026-10-15', poolBoards: ['fanqie.m.new.1141'], dataDates: ['2026-10-12', '2026-10-14', '2026-10-15'],
  }))
  // 第1天=期首基准 null；第3天(10-14)缺前一天 ⇒ null；第4天(10-15)=1900−1500=400
  assert.deepEqual(v.rows[0].extra.pdays, [null, null, null, 400, null, null, null])
  assert.equal(v.rows[0].extra.periodDelta, 900, '期累计仍按期首算（不受中间缺口影响）')
})

test('★ 字数/分类要带进派生行（属主 2026-10-15：在读周榜也要显示作品字数）', () => {
  const withMeta = (key, title, value, rank, wordNumber, catId) => ({
    key, rank, value, title, author: 'A' + key, url: 'https://x/' + key, extra: { wordNumber, catId },
  })
  const table = {
    '2026-10-14': { 'fanqie.m.new.1141': [withMeta('1', '甲', 1000, 1, 208433, 258)] },
    '2026-10-15': { 'fanqie.m.new.1141': [withMeta('1', '甲', 1900, 1, 210000, 258), row('2', '乙', 500, 2)] },
  }
  const v = viewOf(deriveFanqieViews(makeReader(table), {
    date: '2026-10-15', poolBoards: ['fanqie.m.new.1141'], dataDates: ['2026-10-14', '2026-10-15'],
  }))
  const jia = v.rows.find((r) => r.title === '甲')
  assert.equal(jia.extra.words, 210000, '字数取自今日所在分类榜的快照')
  assert.equal(jia.extra.catId, 258)
  // 乙 的快照没有 wordNumber ⇒ 不写这个键（列显示「—」，不是 0）
  const yi = v.rows.find((r) => r.title === '乙')
  assert.equal(yi.extra.words, undefined, '没字数就别编一个 0 出来')
})

test('★ 字数在别的分类榜里也要能取到（同一本书可能只出现在其中一个榜）', () => {
  const a = { key: '1', rank: 1, value: 1000, title: '甲', author: 'A', url: 'u', extra: { catId: 258 } }
  const b = { key: '1', rank: 5, value: 1000, title: '甲', author: 'A', url: 'u', extra: { wordNumber: 123456 } }
  const table = { '2026-10-15': { 'fanqie.m.new.1140': [a], 'fanqie.m.new.258': [b] } }
  const v = viewOf(deriveFanqieViews(makeReader(table), {
    date: '2026-10-15', poolBoards: ['fanqie.m.new.1140', 'fanqie.m.new.258'], dataDates: ['2026-10-15'],
  }))
  assert.equal(v.rows[0].extra.words, 123456, '跨分类榜合并取到字数')
  assert.equal(v.rows[0].extra.catId, 258)
})

