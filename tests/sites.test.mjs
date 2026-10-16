import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { parseShouding, makeQidiantuSite } from '../lib/sites/qidiantu.js'
import { parseRankPage, makeCiweimaoSite, CIWEIMAO_BOARDS } from '../lib/sites/ciweimao.js'
import { makeSfacgSite } from '../lib/sites/sfacg.js'
import { makeQidianMobileSite } from '../lib/sites/qidian-mobile.js'
import { MissingError } from '../lib/scan/types.js'
import { MIN_REQUEST_INTERVAL_MS, createRequestGate, setDefaultRequestGate, waitMsBefore } from '../lib/scan/rate-limit.js'
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
  // 表头齐备（9 列）但没有数据行：这才是「该日期无数据」，不是结构变化
  const empty = '<html><body><table><thead><tr><th>#</th><th>[分类]书名</th><th>首订</th><th>收藏</th><th>收订比</th><th>字数</th><th>粉丝</th><th>作者</th><th>首V时刻</th></tr></thead><tbody></tbody></table></body></html>'
  const site = makeQidiantuSite({ fetchText: async () => empty })
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
  const head = '<thead><tr><th>#</th><th>[分类]书名</th><th>首订</th><th>收藏</th><th>收订比</th><th>字数</th><th>粉丝</th><th>作者</th><th>首V时刻</th></tr></thead>'
  const html = '<table>' + head + '<tr><td><i>1</i></td><td><a href="/info/1050753864">[都市] 某书</a> <a href="/author/某某">某某</a></td><td value="-179">-179</td><td value="4475">4,475</td><td value="9.4">9.4</td><td value="250922">25.09w</td><td value="-91">-91</td><td value="Lv.4">Lv.4</td><td value="08:00">08:00</td></tr></table>'
  const rows = parseShouding(html).rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].value, null, '负首订 ⇒ null')
  assert.equal(rows[0].extra.fans, null, '负粉丝 ⇒ null')
  assert.equal(rows[0].extra.collect, 4475)
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 票 48：数据口径 —— 缺失一律 null，绝不补 0（番茄）
//   实证：Number(null) === 0 且 Number.isFinite(0) ⇒ 缺失被写成真实的 0
//   四种语料：① 字段省略 ② 空串 ③ 占位串 ④ 字段改名
// ─────────────────────────────────────────────────────────────────────────────
test('★ 票 48 番茄：① 字段省略 ② 空串 ③ 占位串 ⇒ 一律 null，不补 0', () => {
  const one = (b) => parseRankApi({ code: 0, data: { book_list: [b] } })[0]
  // ① 字段省略（站点没给）
  const omitted = one({ bookId: '1', bookName: 'A', author: 'B', currentPos: 1 })
  assert.equal(omitted.value, null, 'read_count 省略 ⇒ null')
  assert.equal(omitted.extra.wordNumber, null, 'wordNumber 省略 ⇒ null')
  // 显式 null（Number(null) === 0 就是这条路径）
  const nul = one({ bookId: '1', bookName: 'A', author: 'B', currentPos: null, read_count: null, wordNumber: null })
  assert.equal(nul.value, null, 'read_count=null ⇒ null（不是 0）')
  assert.equal(nul.rank, null, 'currentPos=null ⇒ null（不是 0）')
  assert.equal(nul.extra.wordNumber, null, 'wordNumber=null ⇒ null（不是 0）')
  // ② 空串（Number('') === 0）
  const blank = one({ bookId: '1', bookName: 'A', author: 'B', currentPos: '', read_count: '', wordNumber: '' })
  assert.equal(blank.value, null, 'read_count="" ⇒ null（不是 0）')
  assert.equal(blank.rank, null, 'currentPos="" ⇒ null（不是 0）')
  assert.equal(blank.extra.wordNumber, null, 'wordNumber="" ⇒ null（不是 0）')
  // ③ 占位串
  const ph = one({ bookId: '1', bookName: 'A', author: 'B', currentPos: '-', read_count: '暂无', wordNumber: '--' })
  assert.equal(ph.value, null, 'read_count="暂无" ⇒ null')
  assert.equal(ph.rank, null, 'currentPos="-" ⇒ null')
  assert.equal(ph.extra.wordNumber, null, 'wordNumber="--" ⇒ null')
  // 真值不能被误伤：站点明写 "0" 是真实的 0，保留（只是不把缺失补成 0）
  assert.equal(one({ bookId: '1', bookName: 'A', author: 'B', currentPos: 7, read_count: '0' }).value, 0)
})

test('★ 票 48 番茄：④ 字段改名（bookId → bid）⇒ 不产出 key="undefined"，整榜 missing 不覆盖快照', async () => {
  const renamed = { code: 0, data: { book_list: [{ bid: '7587343301011835966', bookName: 'A', author: 'B', wordNumber: '1', read_count: '9', currentPos: 1 }] } }
  assert.deepEqual(parseRankApi(renamed), [], '字段改名 ⇒ 跳过该行（旧实现产出 key="undefined" 且 url 带 undefined）')
  const site = makeFanqieSite({ boards: [fanqieBoardId('m', 'read', 1141)], fetchJson: async () => renamed })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock, store })
  assert.equal(rec.boards[0].status, 'missing', '整页无有效书号 ⇒ missing（旧实现：塌成 1 行 ok + 覆盖当天真实快照）')
  assert.equal(store.snapshot(fanqieBoardId('m', 'read', 1141), '2026-10-14'), null, '不得落盘')
  // 只坏一行 ⇒ 跳过该行 + warning，不整榜丢
  const mixed = { code: 0, data: { book_list: [
    { bookId: '1', bookName: 'A', author: 'B', wordNumber: '1', read_count: '9', currentPos: 1 },
    { bid: '2', bookName: 'B', author: 'C', wordNumber: '1', read_count: '8', currentPos: 2 },
  ] } }
  const site2 = makeFanqieSite({ boards: [fanqieBoardId('m', 'read', 1141)], fetchJson: async () => mixed })
  const rec2 = await runScan({ sites: [site2], clock, store: new MemoryStore() })
  assert.equal(rec2.boards[0].status, 'ok')
  assert.equal(rec2.boards[0].rows.length, 1, '坏行被跳过')
  assert.ok(rec2.boards[0].warnings.some((w) => w.includes('bookId')), '跳过坏行要留 warning：' + JSON.stringify(rec2.boards[0].warnings))
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 票 49：起点图列校验 + 收订比归一
// ─────────────────────────────────────────────────────────────────────────────
test('★ 票 49 起点图首订：表头列数/文本不符 ⇒ MissingError（站点插一列不能静默读错整列）', async () => {
  const good = fixture('qidiantu-shouding.html')
  assert.equal(parseShouding(good).rows.length, 27, '真实夹具 27 行')
  assert.throws(() => parseShouding(good.replace('<th>收藏</th>', '<th>插队</th><th>收藏</th>')), MissingError, '插一列 ⇒ 列数不符')
  assert.throws(() => parseShouding(good.replace('<th>收订比</th>', '<th>比值</th>')), MissingError, '表头改名 ⇒ 文本不符')
  assert.throws(() => parseShouding(good.replace(/<thead>[\s\S]*?<\/thead>/, '')), MissingError, '表头整个没了 ⇒ 不能瞎读位置')
  // 数据行少一格 ⇒ 列错位等于读错整列 ⇒ 也判 missing
  assert.throws(() => parseShouding(good.replace('<td style="white-space:nowrap;" value=2784>2784</td>', '')), MissingError, '数据行列数 ≠ 表头')
  // 端到端：结构变了 ⇒ 该榜 missing 且不落快照
  const site = makeQidiantuSite({ boards: ['qidiantu.shouding'], fetchText: async () => good.replace('<th>首订</th>', '<th>首定</th>') })
  const store = new MemoryStore()
  const rec = await runScan({ sites: [site], clock, store })
  assert.equal(rec.boards[0].status, 'missing')
  assert.equal(store.snapshot('qidiantu.shouding', '2026-10-14'), null)
})

test('★ 票 49 起点图首订：收订比 -1 / 0（站点伪造值）⇒ null（按 cnt() 口径归一）', () => {
  const parsed = parseShouding(fixture('qidiantu-shouding.html'))
  const ratios = parsed.rows.map((r) => r.extra.ratio)
  assert.equal(ratios.filter((v) => v == null).length, 16, '真实夹具 7 行 -1 + 9 行 0 ⇒ 16 行 null')
  assert.equal(ratios.filter((v) => typeof v === 'number' && v > 0).length, 11, '其余 11 行是真值')
  assert.equal(ratios.some((v) => typeof v === 'number' && v <= 0), false, '不得把 -1/0 当收订比')
  assert.equal(parsed.rows[0].extra.ratio, 9.4, '真值不受影响')
})

test('★ 票 48/49 刺猬猫周榜：条目比 4000 字符长也不能丢字段（原来硬切 slice(0,4000)）', () => {
  const pad = 'x'.repeat(4500)
  const entry = (id, rank, title, author, body) =>
    '<li data-book-id="' + id + '">' + body + '<i>' + rank + '</i>' +
    '<h3 class="tit"><a href="/book/' + id + '/" title="' + title + '">' + title + '</a></h3>' +
    '小说作者：<a href="/user/1">' + author + '</a></li>'
  const html = '<ul>' + entry('1', 1, '甲书', '甲作者', pad) + entry('2', 2, '乙书', '乙作者', '') + '</ul>'
  const rows = parseRankPage(html)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].title, '甲书', '条目内的书名不能被 4000 字符截断')
  assert.equal(rows[0].author, '甲作者', '条目内的作者不能被 4000 字符截断')
  assert.equal(rows[1].author, '乙作者', '短条目照旧')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 票 50：全局限速器 —— 相邻两次真实请求 ≥1s（spec-扫榜插件-v1:87「不可协商」/ Q34）
// ─────────────────────────────────────────────────────────────────────────────
const FANQIE_PAGE = (n) => ({ code: 0, data: { book_list: Array.from({ length: n }, (_, i) => ({ bookId: String(1000000 + i), bookName: '书' + i, author: '作者' + i, wordNumber: '1000', read_count: '5', currentPos: i + 1 })) } })

test('★ 票 50 纯函数 waitMsBefore：上一次真实请求时刻 → 本次还要等多久', () => {
  assert.equal(MIN_REQUEST_INTERVAL_MS, 1000, 'spec-v1:87 限速 1s/请求（不可协商）')
  assert.equal(waitMsBefore(null, 1000000), 0, '从未请求过 ⇒ 不等')
  assert.equal(waitMsBefore(1000000, 1000200), 800)
  assert.equal(waitMsBefore(1000000, 1001000), 0, '正好 1s ⇒ 不等')
  assert.equal(waitMsBefore(1000000, 1009999), 0)
  assert.equal(waitMsBefore(1000000, 999000), 2000, '时钟回拨 ⇒ 仍从上次请求起算最小间隔（不因回拨放行连发）')
  assert.equal(waitMsBefore(1000000, 1000200, 0), 0, '可关（离线/测试）')
  assert.equal(waitMsBefore(1000000, 1000200, 3000), 2800)
})

test('★ 票 50 闸门：注入假时钟 + 假 sleep ⇒ 不真等，相邻登记严格 ≥1s', async () => {
  let t = 0
  const waits = []
  const gate = createRequestGate({ nowMs: () => t, sleep: async (ms) => { waits.push(ms); t += ms } })
  const stamps = []
  for (let i = 0; i < 4; i++) { await gate.beforeRequest(); stamps.push(t) }
  assert.deepEqual(stamps, [0, 1000, 2000, 3000], '相邻真实请求间隔恒为 1s（第 1 次不等）')
  assert.deepEqual(waits, [1000, 1000, 1000], '只等 3 次')
  assert.equal(gate.lastRequestAt(), 3000)
  gate.reset()
  assert.equal(gate.lastRequestAt(), null)
})

test('★ 票 50 通道：一次扫描里所有站共用一个闸门 ⇒ 抓取替身记录的相邻时间戳都 ≥1000ms', async () => {
  let t = 0
  const hitAt = []
  const orig = globalThis.fetch
  globalThis.fetch = async (url) => {
    hitAt.push(t)
    const u = String(url)
    let body
    if (u.includes('fanqienovel.com/api/rank')) body = JSON.stringify(FANQIE_PAGE(10))
    else if (u.includes('ciweimao.com/rank-index')) body = fixture('ciweimao-no-vip-click-week.html')
    else if (u.includes('qidiantu.com/bang/1/6/')) body = fixture('qidiantu-sanjiang.html')
    else if (u.includes('qidiantu.com/shouding')) body = fixture('qidiantu-shouding.html')
    else if (u.includes('m.qidian.com/rank')) body = fixture('qidian-sign-cat12.html')
    else if (u.includes('book.sfacg.com')) body = fixture('sfacg-home.html')
    else throw new Error('未打桩的 URL：' + u)
    return { ok: true, status: 200, text: async () => body }
  }
  setDefaultRequestGate(createRequestGate({ nowMs: () => t, sleep: async (ms) => { t += ms } }))
  try {
    const sites = [
      makeFanqieSite({ boards: [fanqieBoardId('m', 'read', 1141)], depthOf: () => 20 }),
      makeCiweimaoSite({ boards: ['ciweimao.no-vip-click.week'], depthOf: () => 20 }),
      makeQidiantuSite({ boards: ['qidiantu.sanjiang'] }),
      makeSfacgSite({ boards: ['sfacg.new.click'] }),
      makeQidianMobileSite({ boards: ['sign'], categories: ['轻小说'] }),
    ]
    const rec = await runScan({ sites, clock, store: new MemoryStore() })
    assert.deepEqual(rec.boards.map((b) => b.status), ['ok', 'ok', 'ok', 'ok', 'ok'],
      JSON.stringify(rec.boards.map((b) => [b.boardId, b.status, b.reason])))
    assert.equal(hitAt.length, 7, '番茄 2 页 + 刺猬猫 2 页 + 起点图/菠萝包/起点榜各 1 = 7 次真实请求，实际 ' + hitAt.length)
    for (let i = 1; i < hitAt.length; i++) {
      assert.ok(hitAt[i] - hitAt[i - 1] >= 1000,
        '第 ' + i + '→' + (i + 1) + ' 次真实请求间隔 ' + (hitAt[i] - hitAt[i - 1]) + 'ms < 1000ms（跨站/跨页都要算在一条时间线上）')
    }
    assert.equal(t, 6000, '7 次请求 ⇒ 只等了 6 秒（假时钟，没有真等）')
  } finally {
    setDefaultRequestGate(null)
    globalThis.fetch = orig
  }
})

test('★ 票 50 闸门可注入：适配器用自己的闸门（测试替身不碰全局）', async () => {
  let t = 0
  const gate = createRequestGate({ nowMs: () => t, sleep: async (ms) => { t += ms } })
  const orig = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(FANQIE_PAGE(10)) })
  try {
    const site = makeFanqieSite({ boards: [fanqieBoardId('m', 'read', 1141)], depthOf: () => 20, rateGate: gate })
    const rec = await runScan({ sites: [site], clock, store: new MemoryStore() })
    assert.equal(rec.boards[0].status, 'ok')
    assert.equal(rec.boards[0].requests, 2, '一榜两页')
    assert.equal(gate.lastRequestAt(), 1000, '同一闸门登记的两次请求间隔 1s')
    assert.equal(t, 1000)
  } finally {
    globalThis.fetch = orig
  }
})
