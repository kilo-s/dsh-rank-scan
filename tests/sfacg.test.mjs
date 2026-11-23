import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { authorFromBookTitle, parseCnCount, parseDaoSearchRankPage, parseHomeBoard, makeSfacgSite, SFACG_BOARDS } from '../lib/sites/sfacg.js'
import { runScan } from '../lib/scan/run.js'
import { MemoryStore } from '../lib/scan/store.js'

const here = dirname(fileURLToPath(import.meta.url))
const home = readFileSync(join(here, 'fixtures', 'sfacg-home.html'), 'utf8')
const dsP1 = readFileSync(join(here, 'fixtures', 'sfacg-daosearch-p1.html'), 'utf8')
const dsP2 = readFileSync(join(here, 'fixtures', 'sfacg-daosearch-p2.html'), 'utf8')
const clock = { now: () => new Date('2026-10-14T21:00:00+08:00') }

/** 把夹具里的 canonical 替换成当前请求的 rank_type，供离线多榜/多页测试复用 */
function pageFor(url) {
  const m = String(url).match(/rank_type=([a-z0-9_]+)/)
  const rt = m ? m[1] : 'clicks_week'
  const base = String(url).includes('page=2') ? dsP2 : dsP1
  return base.replace(/rank_type=clicks_week/g, 'rank_type=' + rt)
}

test('书页标题取作者：形如「书名 - 小说全文阅读 - 分类 - 作者 - SF轻小说」', () => {
  // 实测样例（2026-10-15 取 https://book.sfacg.com/Novel/783717/ 的 <title>）
  assert.equal(
    authorFromBookTitle('越狱失败后成了典狱长小姐的玩物 - 小说全文阅读 - 纯爱运动女性主角变身橘味 - 日升之时 - SF轻小说'),
    '日升之时',
  )
  assert.equal(authorFromBookTitle('A - 小说全文阅读 - 分类 - 某作者 - SF轻小说'), '某作者')
  // 兜底分支：段数不足时用正则（作者名里带空格也不该截断）
  assert.equal(authorFromBookTitle('书名 - 小说全文阅读 - 分类 - 带空格的 作者名 - SF轻小说'), '带空格的 作者名')
  // 兜底分支：段数不足时用正则
  assert.equal(authorFromBookTitle('书名-小说全文阅读-分类-兜底作者-SF轻小说'), '兜底作者')
  // 拿不到就 null，绝不瞎猜
  assert.equal(authorFromBookTitle(''), null)
  assert.equal(authorFromBookTitle('只有书名'), null)
  assert.equal(authorFromBookTitle('书名 - SF轻小说'), null)
})

test('中文数量缩写解析：支持万/亿/纯数字，缺失或非法一律 null', () => {
  assert.equal(parseCnCount('192.1万字'), 1921000)
  assert.equal(parseCnCount('1.6万'), 16000)
  assert.equal(parseCnCount('1亿'), 100000000)
  assert.equal(parseCnCount('7,017'), 7017)
  assert.equal(parseCnCount(''), null)
  assert.equal(parseCnCount('--'), null)
  assert.equal(parseCnCount(null), null)
})

test('菠萝包首页解析（兼容回归）：三个榜都能解析出 10 条', () => {
  for (const [id, spec] of Object.entries(SFACG_BOARDS)) {
    const rows = parseHomeBoard(home, spec.title, spec.tab)
    assert.ok(rows, id + ' 应能定位到 ' + spec.title + '/' + spec.tab)
    assert.equal(rows.length, 10, id + ' 应有 10 条，实际 ' + (rows && rows.length))
    assert.equal(rows[0].rank, 1)
    assert.ok(rows[0].title.length > 1)
    assert.match(rows[0].url, /^https:\/\/book\.sfacg\.com\/Novel\/\d+\/$/)
    assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], id + ' 名次应连续')
  }
  const news = parseHomeBoard(home, '新书榜', '点击')
  assert.ok(news.every((r) => r.author === null), '首页 SSR 没有作者字段')
  assert.equal(news[0].extra.score, 6)
  assert.ok(news[0].extra.words > 1000, '前两名有字数')
  assert.ok(news[0].extra.collect > 100, '前两名有收藏')
  assert.equal(news[0].extra.titleTruncated, true, '书名被截断要打标')
  assert.equal(news[9].extra.words, null, '第 3 名起没有数值 ⇒ null（不补 0）')
})

test('菠萝包 DaoSearch 真实夹具：每页 20 条，完整书名/作者/字数/收藏与官网链接齐全', () => {
  const p1 = parseDaoSearchRankPage(dsP1)
  const p2 = parseDaoSearchRankPage(dsP2)
  assert.equal(p1.length, 20)
  assert.equal(p2.length, 20)
  assert.deepEqual(p1.map((r) => r.rank), Array.from({ length: 20 }, (_, i) => i + 1))
  assert.deepEqual(p2.map((r) => r.rank), Array.from({ length: 20 }, (_, i) => i + 21))
  assert.equal(p1[0].key, '788076')
  assert.equal(p1[0].title, '申请离职失败后被病娇上司当玩物')
  assert.equal(p1[0].author, '大灰狼和小红帽')
  assert.equal(p1[0].url, 'https://book.sfacg.com/Novel/788076/')
  assert.equal(p1[0].extra.words, 116000)
  assert.equal(p1[0].extra.collect, 3377)
  assert.equal(p1[0].extra.titleTruncated, false)
  assert.equal(p1[0].extra.rankFromPage, true)
  assert.ok(p1.every((r) => r.author && r.extra.words > 0 && r.extra.collect > 0 && !r.extra.titleTruncated))
})

test('★ 票 49 菠萝包：名次来自页面 browse-num（不是按位置补号）；页面不给名次时不静默', async () => {
  const mut = dsP1.replace(/class="browse-num"[^>]*>3<\/span>/, 'class="browse-num">7</span>')
  assert.equal(parseDaoSearchRankPage(mut)[2].rank, 7, '名次必须来自页面 browse-num')
  const noNum = dsP1.replace(/<span class="browse-num"[^>]*>\d+<\/span>/g, '')
  const site = makeSfacgSite({ boards: ['sfacg.hot.week'], depthOf: () => 20, fetchText: async () => noNum })
  const rec = await runScan({ sites: [site], clock, store: new MemoryStore() })
  assert.equal(rec.boards[0].status, 'ok')
  assert.ok(rec.boards[0].warnings.some((w) => w.includes('名次')), '名次不是页面给的 ⇒ 必须 warning：' + JSON.stringify(rec.boards[0].warnings))
})

test('菠萝包：错误页/挑战页/换榜回退 ⇒ missing；未知榜 ⇒ missing', async () => {
  const store = new MemoryStore()
  const bad = makeSfacgSite({ boards: ['sfacg.new.click'], fetchText: async () => '<html><title>Just a moment...</title><body>cf-browser-verification</body></html>' })
  const rec = await runScan({ sites: [bad], clock, store })
  assert.equal(rec.boards[0].status, 'missing')

  // canonical 回退默认月票月榜（不含目标 rank_type）⇒ 必须判 missing，防止静默串榜
  const fallbackHtml = dsP1.replace(/rank_type=clicks_week/g, '')
  const wrongBoard = makeSfacgSite({ boards: ['sfacg.hot.week'], fetchText: async () => fallbackHtml })
  const recWrong = await runScan({ sites: [wrongBoard], clock, store })
  assert.equal(recWrong.boards[0].status, 'missing')

  const unknown = makeSfacgSite({ boards: ['sfacg.zzz'], fetchText: async (u) => pageFor(u) })
  const rec2 = await runScan({ sites: [unknown], clock, store })
  assert.equal(rec2.boards[0].status, 'missing')
})

test('菠萝包：适配器端到端（离线）⇒ 默认翻 2 页截 30 条，三个现有榜全绿且无截断', async () => {
  const urls = []
  const site = makeSfacgSite({
    boards: ['sfacg.new.click', 'sfacg.hot.week', 'sfacg.vip.week'],
    depthOf: () => 30,
    fetchText: async (u) => { urls.push(u); return pageFor(u) },
  })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock, store })
  assert.deepEqual(rec.boards.map((b) => b.status), ['ok', 'ok', 'ok'])
  for (const b of rec.boards) {
    assert.equal(b.rows.length, 30, b.boardId + ' 应截取 30 条')
    assert.equal(b.requests, 2, b.boardId + ' 30 条应发 2 页请求')
    assert.deepEqual(b.rows.map((r) => r.rank), Array.from({ length: 30 }, (_, i) => i + 1))
    assert.ok(b.rows.every((r) => !r.extra.titleTruncated && r.author && r.extra.words > 0 && r.extra.collect > 0))
  }
  assert.ok(urls.some((u) => u.includes('rank_type=new_collections_all')))
  assert.ok(urls.some((u) => u.includes('rank_type=clicks_week') && u.includes('page=2')))
  assert.ok(urls.some((u) => u.includes('rank_type=bestselling_week')))
  assert.ok(store.snapshot('sfacg.hot.week', '2026-10-14'))
})
