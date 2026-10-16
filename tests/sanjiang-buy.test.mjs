import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { parseSanjiang, periodStartOf, makeQidiantuSite, ymd } from '../lib/sites/qidiantu.js'
import { parseBuy, makeCiweimaoSite, CIWEIMAO_BUY_BOARD, CIWEIMAO_BUY_URL } from '../lib/sites/ciweimao.js'
import { runScan } from '../lib/scan/run.js'
import { MemoryStore } from '../lib/scan/store.js'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (f) => readFileSync(join(here, 'fixtures', f), 'utf8')
const clock = { now: () => new Date('2026-10-14T21:00:00+08:00') }

test('三江：期首日计算（周日）+ 真实夹具解析（14 列规则）', () => {
  assert.equal(periodStartOf(new Date('2026-10-14T10:00:00+08:00')), '2026-10-11')
  assert.equal(periodStartOf(new Date('2026-10-11T10:00:00+08:00')), '2026-10-11')
  const rows = parseSanjiang(fx('qidiantu-sanjiang.html'), '2026-10-14', '2026-10-11')
  assert.ok(rows.length >= 10, '应有 10+ 行，实际 ' + rows.length)
  const r = rows[0]
  assert.equal(r.rank, 1)
  assert.ok(r.title.length > 0)
  assert.equal(r.url.startsWith('https://www.qidian.com/book/'), true, '三江条目链接指向起点作品页')
  assert.equal(r.extra.cat, '科幻')
  assert.equal(r.extra.shouding, null, '首订 value=-1 ⇒ 计数类判 null（不能当 -1）')
  assert.ok(r.extra.collectBase > 1000)
  assert.equal(typeof r.value, 'number', '总增量是主指标')
  const daily = r.extra.daily
  assert.equal(daily.length, 7)
  assert.deepEqual(daily.map((d) => d.date), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
  assert.ok(daily[0].delta > 0 && daily[1].delta > 0 && daily[2].delta > 0, '已过天数有增量')
  assert.deepEqual(daily.slice(3).map((d) => d.delta), [null, null, null, null], '未到的天必须 null（页面给的是 value=0，不能当 0 增量）')
  assert.equal(r.extra.settledDays, 3)
})

test('三江：适配器端到端（离线）⇒ ok + 已结算天数警告', async () => {
  const site = makeQidiantuSite({ boards: ['qidiantu.sanjiang'], fetchText: async () => fx('qidiantu-sanjiang.html') })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock, store })
  assert.equal(rec.boards[0].status, 'ok')
  assert.ok(rec.boards[0].warnings.some((w) => w.includes('已结算 3/7')))
  assert.equal(store.snapshot('qidiantu.sanjiang', '2026-10-14').metric, 'value')
})

test('★ 三江：新一期没发布（当期 0 行）⇒ 回退上一期 + 记警告（照刺猬猫写法，最多退 2 期）', async () => {
  const empty = '<html><table><tbody></tbody></table></html>'
  const seen = []
  const site = makeQidiantuSite({
    boards: ['qidiantu.sanjiang'],
    fetchText: async (url) => {
      seen.push(url)
      // 本期（2026-10-11）空 ⇒ 上一期（2026-10-04）给夹具（夹具期首是 10-11，解析仍出 10+ 行）
      return url.endsWith('/2026-10-11') ? empty : fx('qidiantu-sanjiang.html')
    },
  })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock, store })
  assert.equal(rec.boards[0].status, 'ok', '回退成功后该榜必须是 ok（不是 missing）')
  assert.deepEqual(seen, [
    'https://www.qidiantu.com/bang/1/6/2026-10-11',
    'https://www.qidiantu.com/bang/1/6/2026-10-04',
  ], '空当期 → 只退一期，且不重复请求')
  assert.ok(rec.boards[0].warnings.some((w) => w.includes('已回退到上一期')), '必须记一条「回退上一期」警告：实际 ' + JSON.stringify(rec.boards[0].warnings))
  assert.ok(rec.boards[0].warnings.some((w) => w.includes('2026-10-11') && w.includes('2026-10-04')), '警告里要写清本期/回退期的期首日')
  assert.ok(store.snapshot('qidiantu.sanjiang', '2026-10-14').rows.length >= 10, '回退到的数据要落盘')
})

test('★ 三江：本期与上两期全空 ⇒ missing（不无限回退，最多 3 次请求）', async () => {
  const empty = '<html><table><tbody></tbody></table></html>'
  const seen = []
  const site = makeQidiantuSite({ boards: ['qidiantu.sanjiang'], fetchText: async (u) => { seen.push(u); return empty } })
  const rec = await runScan({ sites: [site], clock, store: new MemoryStore() })
  assert.equal(rec.boards[0].status, 'missing')
  assert.equal(seen.length, 3, '本期 + 回退两期 = 最多 3 次请求，不能更多')
  assert.deepEqual(seen, [
    'https://www.qidiantu.com/bang/1/6/2026-10-11',
    'https://www.qidiantu.com/bang/1/6/2026-10-04',
    'https://www.qidiantu.com/bang/1/6/2026-09-27',
  ])
})

test('刺猬猫首订(约)：真实夹具解析 + 第三方标记', () => {
  const j = JSON.parse(fx('ciweimao-buy.json'))
  const rows = parseBuy(j)
  assert.ok(rows.length >= 10, '应有 10+ 本，实际 ' + rows.length)
  const r = rows[0]
  assert.equal(r.rank, 1)
  assert.ok(r.title.length > 0)
  assert.ok(r.author)
  assert.match(r.url, /^https:\/\/www\.ciweimao\.com\/book\/\d+$/)
  assert.equal(typeof r.value, 'number', 'buy_num 去掉 + 号后是数值')
  assert.equal(r.extra.approx, true)
  assert.ok(String(r.extra.source).includes('第三方'))
  assert.equal(Number(j.data.issue), 477)
})

test('刺猬猫首订(约)：当期为空 ⇒ 回退上一期（最多 2 期）', async () => {
  const empty = { code: 0, data: { issue: 500, list: [] } }
  const filled = { code: 0, data: { issue: 499, list: [{ book_id: 1, book_name: 'X', author: 'A', buy_num: '100+' }] } }
  let calls = 0
  const site = makeCiweimaoSite({
    boards: [CIWEIMAO_BUY_BOARD],
    fetchText: async (url) => {
      calls += 1
      const isPrev = url.includes('issue=')
      return JSON.stringify(isPrev ? filled : empty)
    },
  })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock, store })
  assert.equal(rec.boards[0].status, 'ok')
  assert.equal(calls, 2, '第一次空 + 回退一次')
  assert.ok(rec.boards[0].warnings.some((w) => w.includes('回退到第 499 期')))
  assert.ok(rec.boards[0].warnings.some((w) => w.includes('第三方约值')))
  assert.equal(CIWEIMAO_BUY_URL.startsWith('http://'), true, '必须用 http（https 在本机被重置）')
  assert.equal(store.snapshot(CIWEIMAO_BUY_BOARD, '2026-10-14').metric, 'value', '首订榜是数值型（覆盖刺猬猫站点级 rank）')
  const other = makeCiweimaoSite({ boards: ['ciweimao.no-vip-click.week'], fetchText: async () => '<html><title>刺猬猫</title></html>' })
  const recOther = await runScan({ sites: [other], clock, store: new MemoryStore() })
  assert.equal(recOther.boards[0].status, 'missing', '错误页仍判 missing')
})
test('★ 起点图首订：历史日期要请求 /shouding/<日期>（回归：曾读从未设置的 ctx.dateOf ⇒ 永远抓当日）', async () => {
  const seen = []
  const oneRow = '<table><tbody><tr>' +
    '<td>1</td><td><a href="/info/1050725440">甲书</a></td>' +
    '<td value="1">1</td><td value="2">2</td><td value="3">3</td><td value="4">4</td><td value="5">5</td>' +
    '</tr></tbody></table>'
  const site = makeQidiantuSite({
    boards: ['qidiantu.shouding'],
    fetchText: async (url) => { seen.push(url); return oneRow },
  })
  // 非当日 ⇒ 必须带日期路径
  await site.fetchBoard('qidiantu.shouding', { now: () => new Date('2026-10-11T12:00:00+08:00'), signal: undefined, requestTimeoutMs: 5000 })
  // 当日 ⇒ 走 /shouding/
  // ★ 当日判定必须走注入时钟（曾经用真实 new Date() 比 ⇒ 跨过午夜这条测试就红，且不可确定性复现）
  await site.fetchBoard('qidiantu.shouding', {
    now: () => new Date('2026-10-15T12:00:00+08:00'),
    todayIso: '2026-10-15',
    signal: undefined,
    requestTimeoutMs: 5000,
  })
  const todayStr = '2026-10-15'
  assert.equal(seen[0], 'https://www.qidiantu.com/shouding/2026-10-11', '历史日期要带日期（曾被 ctx.dateOf 短路成当日）')
  assert.equal(seen[1], 'https://www.qidiantu.com/shouding/', '当日（' + todayStr + '）走无日期路径')
  assert.notEqual(seen[0], seen[1], '两个日期不能落到同一个 URL —— 那正是「不同日期作品都一样」的根因')
})
test('★ 日期必须补零（回归：/shouding/2026-10-1 只返回 26 字节空页 ⇒ 被误判成「该日期无数据」）', async () => {
  assert.equal(ymd(new Date(2026, 9, 1)), '2026-10-01')
  assert.equal(ymd(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(ymd(new Date(2026, 11, 31)), '2026-12-31')
  const seen = []
  const site = makeQidiantuSite({ boards: ['qidiantu.shouding'], fetchText: async (u) => { seen.push(u); return '<table><tbody></tbody></table>' } })
  try { await site.fetchBoard('qidiantu.shouding', { now: () => new Date(2026, 9, 1, 12), signal: undefined, requestTimeoutMs: 5000 }) } catch (e) {}
  // 单数字月/日必须补零，否则站点给 26 字节空页
  assert.equal(seen[0], 'https://www.qidiantu.com/shouding/2026-10-01', '日期路径必须补零，不能是 2026-10-1')
  assert.ok(!/\/shouding\/\d{4}-\d-\d$/.test(seen[0]), '不能出现未补零的日期路径')
})

