import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveFanqieViews } from '../lib/scan/derive.js'

const snap = (boardId, date, base) => ({ boardId, dataDate: date, metric: 'value', rows: Array.from({ length: 30 }, (_, i) => ({ key: 'k' + i, rank: i + 1, value: base + i, title: '书' + i, author: null, url: null })) })

test('★ 派生榜读取去重：底层读书次数与「书数」无关，只与 池 × 日期 有关', () => {
  const boards = ['fanqie.m.new.1', 'fanqie.m.new.2', 'fanqie.m.new.3']
  const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']
  const store = new Map()
  dates.forEach((d, i) => { for (const b of boards) store.set(d + '|' + b, snap(b, d, 100 * (i + 1))) })
  let n = 0
  const read = (b, d) => { n++; return store.get(d + '|' + b) || null }
  const views = deriveFanqieViews(read, { date: '2026-10-15', poolBoards: boards, dataDates: dates })
  const v = views.find((x) => x.boardId === 'fanqie.derived.period')
  assert.ok(v && v.rows.length === 30, '应算出 30 行')
  assert.ok(n <= boards.length * (dates.length + 7), '读书次数必须与书数无关（去重前这里是数千次），实际 ' + n)
  // 契约：value = 今日涨幅（排序用），extra.read = 今日在读，extra.periodDelta = 本期累计
  const row = v.rows.find((r) => r.key === 'k0')
  assert.equal(row.extra.read, 400, '今日在读 = 该日期快照值')
  assert.equal(row.value, 100, 'value 是今日涨幅（400 − 前一天 300）')
  assert.equal(row.extra.periodDelta, 300, '本期累计 = 今日 − 期首')
  assert.equal(row.extra.inPoolDays, 4, '池内天数 = 本期有数据的 4 天')
})
