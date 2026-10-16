import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runScan } from '../lib/scan/run.js'
import { MemoryStore } from '../lib/scan/store.js'
import { makeQidianMobileSite, parseRankPage, boardId } from '../lib/sites/qidian-mobile.js'

const clockAt = (iso) => ({ now: () => new Date(iso) })

// 离线夹具：形状取自 2026-10-14 真实响应（起点移动端签约榜·轻小说）
function fixture(rows) {
  const records = rows.map((r, i) => ({
    catId: 12, bName: r[0], rankNum: i + 1, cat: '轻小说', cnt: r[1] + '万字',
    subCatId: 60, bid: String(r[2]), subCat: r[3], bAuth: r[4], desc: '简介' + (i + 1), _index: i,
  }))
  const payload = { pageContext: { pageProps: { pageData: { total: 174, gender: 'male', isLast: 0, records } } } }
  return '<html><script id="vite-plugin-ssr_pageContext" type="application/json">' + JSON.stringify(payload) + '</script></html>'
}

const SAMPLE = [
  ['有仙则名', '9.83', 1049003034, '原生幻想', '金色茉莉花'],
  ['高中的非正常修仙！', '7.27', 1050911792, '原生幻想', '七月封阳'],
  ['同时穿越：我在美漫继承万界遗产', '12.43', 1050950159, '衍生同人', '比俗更俗'],
]
const FIXTURE20 = fixture(Array.from({ length: 20 }, (_, i) => ['书' + (i + 1), '10.0', 1050000000 + i, '原生幻想', '作者' + (i + 1)]))

test('夹具解析：字段齐备（名次/书名/作者/书号/分类/子分类/字数）', () => {
  const parsed = parseRankPage(fixture(SAMPLE))
  assert.equal(parsed.total, 174)
  assert.equal(parsed.rows.length, 3)
  const r = parsed.rows[0]
  assert.equal(r.rank, 1)
  assert.equal(r.title, '有仙则名')
  assert.equal(r.author, '金色茉莉花')
  assert.equal(r.key, '1049003034')
  assert.equal(r.url, 'https://www.qidian.com/book/1049003034/')
  assert.equal(r.extra.cat, '轻小说')
  assert.equal(r.extra.subCat, '原生幻想')
  assert.equal(r.extra.wordsText, '9.83万字')
})

test('适配器端到端（离线）：一榜 20 条 → ok，并落快照', async () => {
  const site = makeQidianMobileSite({ boards: ['sign'], categories: ['轻小说'], fetchText: async () => FIXTURE20 })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock: clockAt('2026-10-14T04:00:00+08:00'), store })
  assert.equal(rec.outcome, 'completed')
  assert.equal(rec.boards[0].status, 'ok')
  assert.equal(rec.boards[0].rows.length, 20)
  const snap = store.snapshot(boardId('sign', 12), '2026-10-14')
  assert.equal(snap.metric, 'rank')
  assert.equal(snap.rows.length, 20)
})

test('条数异常（非 20）⇒ missing，不产出条目', async () => {
  const site = makeQidianMobileSite({ boards: ['sign'], categories: ['轻小说'], fetchText: async () => fixture(SAMPLE) })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock: clockAt('2026-10-14T05:00:00+08:00'), store })
  assert.equal(rec.boards[0].status, 'missing')
  assert.match(rec.boards[0].reason, /条数异常/)
  assert.equal(store.snapshot(boardId('sign', 12), '2026-10-14'), null)
})
