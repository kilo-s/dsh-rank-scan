import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { parseShouding, makeQidiantuSite } from '../lib/sites/qidiantu.js'
import { parseRankPage, makeCiweimaoSite, CIWEIMAO_BOARDS } from '../lib/sites/ciweimao.js'
import { looksSwapped, looksUnchanged, overlapCount } from '../lib/scan/judges.js'
import { parseRankApi, makeFanqieSite, fanqieBoardId, FANQIE_MALE, FANQIE_FEMALE } from '../lib/sites/fanqie.js'
import { runScan } from '../lib/scan/run.js'
import { MemoryStore } from '../lib/scan/store.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (f) => readFileSync(join(here, 'fixtures', f), 'utf8')
const ctx = () => ({ now: () => new Date(), signal: new AbortController().signal, requestTimeoutMs: 15000 })
const clock = { now: () => new Date('2026-10-14T20:00:00+08:00') }

test('起点图 首订榜（真实夹具）：字段齐备且取 td[value] 精确值', () => {
  const parsed = parseShouding(fixture('qidiantu-shouding.html'))
  assert.ok(parsed.rows.length >= 20, '当日榜应有 20+ 行，实际 ' + parsed.rows.length)
  // 页面标题不含日期；datePicker 里是「本页数据对应的上架日」（首订榜展示的是最近一期，通常为昨天）
  assert.match(parsed.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(parsed.date <= '2026-10-14', '内容日期不应晚于抓取日')
  const r = parsed.rows[0]
  assert.equal(r.rank, 1)
  assert.ok(r.title.length > 0)
  assert.ok(r.author, '作者应能取到')
  assert.equal(typeof r.value, 'number', '首订必须是数字（来自 td[value]）')
  assert.ok(r.value > 0)
  assert.ok(r.extra.collect > 1000, '收藏取 value 而非显示文本')
  assert.ok(r.extra.wordsCnt > 10000, '字数取 value')
  assert.ok(r.extra.cat, '分类来自 [分类]')
  // 既定口径：作品链接要跳 **起点作品页**（起点图 /info 只留作 qidiantuUrl 备用）
  assert.match(r.url, /^https:\/\/www\.qidian\.com\/book\/\d+\/$/)
  assert.match(r.extra.qidiantuUrl, /^https:\/\/www\.qidiantu\.com\/info\/\d+$/)
  assert.equal(r.extra.ratio, 9.4, '收订比取第 5 个 cell')
})

test('起点图：空榜（200 但 0 行）⇒ missing', async () => {
  const site = makeQidiantuSite({ fetchText: async () => '<html><body><table><tr><th>#</th></tr></table></body></html>' })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock, store })
  assert.equal(rec.boards[0].status, 'missing')
  assert.match(rec.boards[0].reason, /0 行/)
})

test('起点图：适配器端到端（离线，value 型）⇒ 落快照', async () => {
  const site = makeQidiantuSite({ fetchText: async () => fixture('qidiantu-shouding.html') })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock, store })
  assert.equal(rec.boards[0].status, 'ok')
  const snap = store.snapshot('qidiantu.shouding', '2026-10-14')
  assert.equal(snap.metric, 'value')
  assert.ok(snap.rows[0].value > 0)
})

test('刺猬猫 周期榜（真实夹具）：10 条、名次/书名/作者/书号齐备', () => {
  const rows = parseRankPage(fixture('ciweimao-no-vip-click-week.html'))
  assert.equal(rows.length, 10)
  assert.equal(rows[0].rank, 1)
  assert.ok(rows[0].title.length > 1)
  assert.ok(rows[0].author, '作者应能取到')
  assert.match(rows[0].url, /^https:\/\/www\.ciweimao\.com\/book\/\d+$/)
  assert.equal(rows[0].value, null, '刺猬猫条目没有数值字段 ⇒ 名次型')
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('刺猬猫：错误页（<title>刺猬猫</title>）⇒ missing', async () => {
  const site = makeCiweimaoSite({ fetchText: async () => '<html><head><title>刺猬猫</title></head><body>错误</body></html>' })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock, store, boards: ['ciweimao.no-vip-click.week'] })
  assert.equal(rec.boards[0].status, 'missing')
  assert.equal(Object.keys(CIWEIMAO_BOARDS).length, 2)
})

test('判据：换榜/降级（交集 ≤2）与未刷新（版本全等）', () => {
  const cur = [1, 2, 3, 4, 5].map((n) => ({ key: 'k' + n, rank: n, value: null, title: 'T', author: null, url: null }))
  const same = cur.map((r) => ({ ...r }))
  const shifted = [9, 10, 11, 12, 13].map((n) => ({ key: 'k' + n, rank: n, value: null, title: 'T', author: null, url: null }))
  assert.equal(overlapCount(cur, shifted), 0)
  assert.equal(looksSwapped(cur, shifted), true)
  assert.equal(looksSwapped(cur, same), false)
  assert.equal(looksUnchanged(cur, [same]), true)
  assert.equal(looksUnchanged(cur, [shifted]), false)
})
test('番茄 分类榜 API：字段映射（read_count 才是真值，readCount 恒 0 不能用）', () => {
  const json = {
    code: 0,
    data: {
      total_num: 100,
      rankVersion: 1791971400,
      book_list: [
        { bookId: '7587343301011835966', bookName: '苍陆纪元', author: '泽宇界剑锋', wordNumber: '1502976', read_count: '792260', readCount: '0', currentPos: 1, rankPosDiff: 0, curent_category_id: 1141, uid: '810764621066336', lastChapterUpdateTime: '1768815632' },
        { bookId: '7455863093835336729', bookName: '某书', author: '某人', wordNumber: '800000', read_count: '123', readCount: '0', currentPos: 2, rankPosDiff: -1, curent_category_id: 1141 },
      ],
    },
  }
  const rows = parseRankApi(json)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].key, '7587343301011835966')
  assert.equal(rows[0].rank, 1)
  assert.equal(rows[0].value, 792260, '取 read_count 而不是 readCount')
  assert.equal(rows[0].extra.wordNumber, 1502976)
  assert.equal(rows[0].extra.rankPosDiff, 0)
  assert.equal(rows[0].url, 'https://fanqienovel.com/page/7587343301011835966')
const PUA_T = String.fromCodePoint(0xe4c2)
  // 语义（2026-10-15 起）：只有**解不干净的私用区码点**才算可疑；全干净的标题不该被标脏
  assert.equal(rows[0].extra.titleSuspect, false, '干净标题不标 suspect')
  const dirty = parseRankApi({ data: { book_list: [{ bookId: '9', bookName: '转' + PUA_T + '天使', author: '甲', read_count: '1', currentPos: 1 }] } })
  assert.equal(dirty[0].extra.titleSuspect, true, '含私用区码点 ⇒ suspect')
  assert.equal(dirty[0].extra.titlePua, '转' + PUA_T + '天使', '原始 PUA 文本留给映射学习')
})

test('番茄：适配器端到端（离线，value 型）+ 接口报错 ⇒ missing', async () => {
  const good = { code: 0, data: { book_list: [{ bookId: '1', bookName: 'A', author: 'B', wordNumber: '1', read_count: '9', currentPos: 1 }] } }
  const site = makeFanqieSite({ boards: [fanqieBoardId('m', 'read', 1141)], fetchJson: async () => good })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock, store })
  assert.equal(rec.boards[0].status, 'ok')
  assert.equal(store.snapshot(fanqieBoardId('m', 'read', 1141), '2026-10-14').metric, 'value')

  const bad = makeFanqieSite({ boards: ['fanqie.m.read.1141'], fetchJson: async () => ({ code: -1, message: 'invalid params' }) })
  const store2 = new MemoryStore()
  const rec2 = await runScan({ sites: [bad], clock, store: store2 })
  assert.equal(rec2.boards[0].status, 'missing')
})

test('番茄：分类字典（男 19 / 女 18，三个 id 跨性别共用）', () => {
  assert.equal(FANQIE_MALE.length, 19)
  assert.equal(FANQIE_FEMALE.length, 18)
  const shared = FANQIE_MALE.map(([id]) => id).filter((id) => FANQIE_FEMALE.some(([fid]) => fid === id))
  assert.deepEqual(shared.sort((a, b) => a - b), [8, 539, 746])
  assert.equal(fanqieBoardId('f', 'new', 1017), 'fanqie.f.new.1017')
})
test('起点图 首订榜：负数/0 属计数类 ⇒ 记 null（绝不显示负数）', () => {
  const html = '<table><tr><td><i>1</i></td><td><a href="/info/1050753864">[都市] 某书</a> <a href="/author/某某">某某</a></td><td value="-179">-179</td><td value="4475">4,475</td><td value="9.4">9.4</td><td value="250922">25.09w</td><td value="-91">-91</td><td value="Lv.4">Lv.4</td><td value="08:00">08:00</td></tr></table>'
  const rows = parseShouding(html).rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].value, null, '负首订 ⇒ null')
  assert.equal(rows[0].extra.fans, null, '负粉丝 ⇒ null')
  assert.equal(rows[0].extra.collect, 4475)
})
