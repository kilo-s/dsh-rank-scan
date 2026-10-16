import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { authorFromBookTitle, parseHomeBoard, makeSfacgSite, SFACG_BOARDS } from '../lib/sites/sfacg.js'
import { runScan } from '../lib/scan/run.js'
import { MemoryStore } from '../lib/scan/store.js'

const here = dirname(fileURLToPath(import.meta.url))
const home = readFileSync(join(here, 'fixtures', 'sfacg-home.html'), 'utf8')
const clock = { now: () => new Date('2026-10-14T21:00:00+08:00') }

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
  // 拿不到就 null，绝不瞎猜（首页榜本来就没有作者）
  assert.equal(authorFromBookTitle(''), null)
  assert.equal(authorFromBookTitle('只有书名'), null)
  assert.equal(authorFromBookTitle('书名 - SF轻小说'), null)
})

test('首页榜本身没有作者（作者只能靠书页补全）', () => {
  const rows = parseHomeBoard(home, '新书榜', '点击')
  assert.ok(rows && rows.length, '首页榜应能解析出条目')
  assert.ok(rows.every((r) => r.author === null), '首页 SSR 没有作者字段')
})

test('菠萝包首页（真实夹具）：三个榜都能解析出 10 条', () => {
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
  assert.equal(news[0].extra.score, 6)
  assert.ok(news[0].extra.words > 1000, '前两名有字数')
  assert.ok(news[0].extra.collect > 100, '前两名有收藏')
  assert.equal(news[0].extra.titleTruncated, true, '书名被截断要打标')
  assert.equal(news[9].extra.words, null, '第 3 名起没有数值 ⇒ null（不补 0）')
})

test('菠萝包：错误页 ⇒ missing；未知榜 ⇒ missing', async () => {
  const bad = makeSfacgSite({ boards: ['sfacg.new.click'], fetchText: async () => '<html><title>出错了</title><body>很抱歉给您带来不便</body></html>' })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [bad], clock, store })
  assert.equal(rec.boards[0].status, 'missing')

  const unknown = makeSfacgSite({ boards: ['sfacg.zzz'], fetchText: async () => home })
  const rec2 = await runScan({ sites: [unknown], clock, store: new MemoryStore() })
  assert.equal(rec2.boards[0].status, 'missing')
})

test('菠萝包：适配器端到端（离线）⇒ 落快照 + 截断警告', async () => {
  const site = makeSfacgSite({ boards: ['sfacg.hot.week', 'sfacg.vip.week'], fetchText: async () => home })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock, store })
  assert.deepEqual(rec.boards.map((b) => b.status), ['ok', 'ok'])
  assert.equal(rec.boards[0].rows.length, 10)
  assert.ok(rec.boards[0].warnings.some((w) => w.includes('截断')))
  assert.ok(store.snapshot('sfacg.hot.week', '2026-10-14'))
})
