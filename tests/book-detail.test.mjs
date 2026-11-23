import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { readClientSource } from './_client-source.mjs'
import { daoSearchSiteOf, mergeBookHonours, parseDaoSearchBookPage } from '../lib/sites/daosearch-book.js'
import { parseCiweimaoBookDesc } from '../lib/sites/ciweimao.js'
import { cachedDetail, cachedEntry, putEntries } from '../lib/scan/book-cache.js'
import { parseRankApi } from '../lib/sites/fanqie.js'
import { parseDaoSearchRankPage } from '../lib/sites/sfacg.js'

const SAMPLE_HTML = `
<article class="book-page bc">
  <div class="book-detail-header source-sfacg">
    <dl class="book-facts">
      <div><dt>状态</dt><dd>连载中</dd></div>
      <div><dt>字数</dt><dd>25.9万字</dd></div>
      <div><dt>分类</dt><dd><a href="/sfacg/library?genre=15">奇幻</a></dd></div>
    </dl>
  </div>
  <section class="detail-section book-synopsis">
    <div class="reading-copy clampable">
      <p class="reading-para">　　第一段简介：屠龙少年失业了&#43;意外转生。</p>
      <p class="reading-para">第二段简介：报考龙姬学院后的日常。</p>
    </div>
  </section>
  <section class="detail-section book-tags">
    <ul class="tag-row"><li><span class="meta-chip is-tag">VIP付费</span></li></ul>
    <ul class="tag-row">
      <li><a class="meta-chip is-tag" href="/t/1">变身</a></li>
      <li><a class="meta-chip is-tag" href="/t/2">多女主</a></li>
      <li><a class="meta-chip is-tag" href="/t/3">变身</a></li>
    </ul>
  </section>
  <section class="detail-section book-honours">
    <ul class="honours-badges">
      <li><a class="honour-badge rank-second" href="/r/1"><span class="honour-rank">2</span><span class="honour-label">新书收藏榜</span></a></li>
      <li><a class="honour-badge rank-third" href="/r/2"><span class="honour-rank">3</span><span class="honour-label">收藏月榜</span></a></li>
      <li><span class="honour-badge honour-split"><a class="honour-rank-link"><span class="honour-rank">13</span></a><span class="honour-body"><a class="honour-main"><span class="honour-label">月票月榜</span></a><a class="honour-also"><span class="honour-channel">魔幻第7名</span></a></span></span></li>
    </ul>
  </section>
</article>
`

test('daoSearchSiteOf：五站映射正确（起点图复用起点），非法站返回 null', () => {
  assert.equal(daoSearchSiteOf('qidian'), 'qidian')
  assert.equal(daoSearchSiteOf('qidiantu'), 'qidian')
  assert.equal(daoSearchSiteOf('fanqie'), 'fanqie')
  assert.equal(daoSearchSiteOf('ciweimao'), 'ciweimao')
  assert.equal(daoSearchSiteOf('sfacg'), 'sfacg')
  assert.equal(daoSearchSiteOf('unknown'), null)
  assert.equal(daoSearchSiteOf(''), null)
})

test('parseDaoSearchBookPage：正确解析多段简介、去重标签、状态分类与普通/复合上榜徽章', () => {
  const got = parseDaoSearchBookPage(SAMPLE_HTML)
  assert.ok(got)
  assert.equal(got.desc, '第一段简介：屠龙少年失业了+意外转生。\n第二段简介：报考龙姬学院后的日常。')
  assert.deepEqual(got.tags, ['VIP付费', '变身', '多女主'])
  assert.equal(got.status, '连载中')
  assert.equal(got.category, '奇幻')
  assert.equal(got.honours.length, 3)
  assert.deepEqual(got.honours[0], { rank: 2, label: '新书收藏榜', sub: null, source: 'daosearch' })
  assert.deepEqual(got.honours[2], { rank: 13, label: '月票月榜', sub: '魔幻第7名', source: 'daosearch' })
})

test('parseDaoSearchBookPage：404 / CF 挑战页返回 null', () => {
  assert.equal(parseDaoSearchBookPage('<title>Just a moment...</title><div class="book-page"></div>'), null)
  assert.equal(parseDaoSearchBookPage('<html><title>404 Not Found</title></html>'), null)
  assert.equal(parseDaoSearchBookPage(''), null)
})

test('mergeBookHonours：排除当前正看的榜（含别名）、本地优先、跨源同义榜去重与旧缓存重复尾缀清洗', () => {
  const local = [
    { rank: 2, label: '新书榜（点击）', boardId: 'sfacg.new.click', source: 'local' },
    { rank: 9, label: 'VIP热销榜（周）', boardId: 'sfacg.vip.week', source: 'local' },
  ]
  const ds = [
    { rank: 2, label: '新书收藏榜', sub: null, source: 'daosearch' },
    { rank: 3, label: '收藏月榜', sub: null, source: 'daosearch' },
    { rank: 13, label: '月票月榜', sub: '魔幻第7名', source: 'daosearch' },
    { rank: 9, label: '热销周榜', sub: null, source: 'daosearch' },
    { rank: 31, label: '推荐榜 轻小说', sub: '轻小说', source: 'daosearch' },
  ]
  const merged = mergeBookHonours(local, ds, 'sfacg.new.click', '新书榜（点击）')
  assert.deepEqual(merged.map((x) => x.label), ['VIP热销榜（周）', '收藏月榜', '月票月榜', '推荐榜'])
  assert.equal(merged[0].source, 'local')
  assert.equal(merged[3].sub, '轻小说')
})

test('parseDaoSearchBookPage：起点内嵌 honour-channel 不重复拼进 label', () => {
  const html = `
    <article class="book-page">
      <div class="book-detail-header"></div>
      <section class="detail-section book-honours">
        <ul class="honours-badges">
          <li><a class="honour-badge"><span class="honour-rank">31</span><span class="honour-label">推荐榜 <span class="honour-channel">轻小说</span></span></a></li>
        </ul>
      </section>
    </article>
  `
  const got = parseDaoSearchBookPage(html)
  assert.ok(got)
  assert.deepEqual(got.honours, [{ rank: 31, label: '推荐榜', sub: '轻小说', source: 'daosearch' }])
})

test('book-cache：详情元数据与读数补全双向合并互不冲掉，detailFetchedAt 独立判 TTL', () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-bdet-'))
  try {
    putEntries(root, [{ site: 'ciweimao', bookId: '100508295', entry: { collect: 5000, words: 160000, title: '书', author: '作者', score: null } }])
    assert.equal(cachedDetail(root, 'ciweimao', '100508295', 7 * 86400000).hit, false, '只有读数缓存时详情不应误判命中')
    putEntries(root, [{
      site: 'ciweimao',
      bookId: '100508295',
      entry: {
        collect: null, words: null, title: null, author: null, score: null,
        desc: '完整简介', tags: ['多女主', '轻小说'], status: '连载中', category: '玄幻奇幻',
        honours: [{ rank: 3, label: '收藏月榜', source: 'daosearch' }],
      },
    }])
    const dHit = cachedDetail(root, 'ciweimao', '100508295', 7 * 86400000)
    assert.equal(dHit.hit, true)
    assert.equal(dHit.entry.desc, '完整简介')
    assert.deepEqual(dHit.entry.tags, ['多女主', '轻小说'])
    assert.equal(dHit.entry.collect, 5000, '写详情不能把已有收藏冲掉')
    // 再次只更新读数，详情字段必须保留
    putEntries(root, [{ site: 'ciweimao', bookId: '100508295', entry: { collect: 5200, words: 165000, title: null, author: null, score: null } }])
    const after = cachedEntry(root, 'ciweimao', '100508295', 0).entry
    assert.equal(after.collect, 5200)
    assert.equal(after.desc, '完整简介', '读数更新不能冲掉详情简介')
    assert.deepEqual(after.tags, ['多女主', '轻小说'], '读数更新不能冲掉标签')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('零请求顺带字段：番茄榜解析解码后简介与状态；菠萝包 DaoSearch 榜页解析月票与人气', () => {
  const fqRows = parseRankApi({
    data: {
      book_list: [{
        bookId: '7687494043038665752',
        bookName: '样书',
        author: '作者',
        currentPos: 1,
        read_count: 10000,
        wordNumber: 120000,
        creationStatus: '1',
        abstract: '第一句。\n第二句。',
      }],
    },
  })
  assert.equal(fqRows[0].extra.desc, '第一句。\n第二句。')
  assert.equal(fqRows[0].extra.status, '连载中')

  const sfRows = parseDaoSearchRankPage(`
    <li class="row-with-save">
      <a href="/sfacg/book/788076/slug?lang=zh" class="browse-row">
        <span class="browse-num">1</span>
        <strong>测试轻小说</strong>
        <span class="chart-byline">测试作者</span>
        <span class="meta-chip"><svg><use href="#i-lines"/></svg>11.6万字</span>
        <span class="chart-stats">
          <span class="chart-stat"><span class="chart-stat-val">37</span><span class="chart-stat-lbl">月票</span></span>
          <span class="chart-stat"><span class="chart-stat-val">18.8万</span><span class="chart-stat-lbl">人气</span></span>
          <span class="chart-stat"><span class="chart-stat-val">3377</span><span class="chart-stat-lbl">收藏</span></span>
        </span>
      </a>
    </li>
  `)
  assert.equal(sfRows[0].extra.monthlyTickets, 37)
  assert.equal(sfRows[0].extra.popularity, 188000)
  assert.equal(sfRows[0].extra.collect, 3377)
})

test('shortHonourSub：去重与作品分类重复的频道后缀，保留有价值的分类名次', () => {
  let reg = null
  const sandbox = {
    console, Promise, JSON, Math, Number, String, Object, Array, Date, RegExp, Error,
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { createElement: () => ({ style: {}, setAttribute: () => {}, remove: () => {} }), head: { appendChild: () => {} }, body: { appendChild: () => {} }, addEventListener: () => {}, removeEventListener: () => {}, querySelectorAll: () => [] },
    __ModuleLoader__: { load: (r) => { reg = r } },
  }
  sandbox.window = sandbox
  sandbox.window.addEventListener = () => {}
  sandbox.window.removeEventListener = () => {}
  vm.runInContext(readClientSource(), vm.createContext(sandbox), { filename: 'client/parts/*.js' })
  const fakeReact = { Component: function () {}, createElement: () => ({}), useState: (v) => [v, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }), useCallback: (f) => f, useMemo: (f) => f() }
  reg.factory((s) => { if (s === 'react') return fakeReact; throw new Error(s) })
  const shortHonourSub = sandbox.window.__rankScanBoardTableTest.shortHonourSub
  assert.equal(shortHonourSub({ rank: 1, label: '收藏月榜', sub: '科幻无限第1名' }, '科幻无限'), null)
  assert.equal(shortHonourSub({ rank: 3, label: '收藏月榜', sub: '玄幻奇幻第1名' }, '玄幻奇幻'), '分类#1')
  assert.equal(shortHonourSub({ rank: 139, label: '月票榜', sub: '轻小说第29名' }, '轻小说 · 原生幻想'), '分类#29')
  assert.equal(shortHonourSub({ rank: 31, label: '推荐榜', sub: '轻小说' }, '轻小说 · 原生幻想'), null)
  assert.equal(shortHonourSub({ rank: 13, label: '月票月榜', sub: '魔幻第7名' }, '奇幻'), '魔幻#7')
  assert.equal(shortHonourSub({ rank: 4, label: '热销周榜', sub: null }, '都市'), null)
})

test('parseCiweimaoBookDesc：保留原站 <br /> 段落换行并过滤黄色活动条，原站简介不被单段聚合覆盖', () => {
  const html = `
    <div class="book-desc J_mCustomScrollbar">
      <p style="color:#fbc02d">【2026征文活动】</p>
      　　南翔因为意外被卷入了雷奥尼克斯格斗中<br />\r\n
      <br />\r\n
      其他的雷奥尼克斯们纷纷晒出了自己的初始怪兽&#44;只有南翔陷入沉思<br />\r\n
      “什么叫，我的三个格子里塞的是万代、圆谷、东宝？”
    </div>
  `
  const desc = parseCiweimaoBookDesc(html)
  assert.equal(desc, [
    '南翔因为意外被卷入了雷奥尼克斯格斗中',
    '其他的雷奥尼克斯们纷纷晒出了自己的初始怪兽,只有南翔陷入沉思',
    '“什么叫，我的三个格子里塞的是万代、圆谷、东宝？”',
  ].join('\n'))

  const root = mkdtempSync(join(tmpdir(), 'rank-scan-cwdesc-'))
  try {
    // 补全阶段顺手写入原站简介，不应提前置位 detailFetchedAt（展开详情仍需拉取标签与现榜）
    putEntries(root, [{
      site: 'ciweimao', bookId: '100509717',
      entry: { collect: 1200, words: 80000, title: null, author: null, score: null, desc, descSource: 'origin' },
    }])
    assert.equal(cachedDetail(root, 'ciweimao', '100509717', 7 * 86400000).hit, false)
    // 之后 DaoSearch 写入单段无换行简介 + 标签时，必须保留原站分段简介
    putEntries(root, [{
      site: 'ciweimao', bookId: '100509717',
      entry: { collect: null, words: null, title: null, author: null, score: null, desc: '粘成一整段的聚合简介', descSource: 'daosearch', tags: ['同人'], status: '连载中' },
    }])
    const hit = cachedDetail(root, 'ciweimao', '100509717', 7 * 86400000)
    assert.equal(hit.hit, true)
    assert.equal(hit.entry.desc, desc, '原站多段简介绝不能被 DaoSearch 单段简介覆盖')
    assert.equal(hit.entry.descSource, 'origin')
    assert.deepEqual(hit.entry.tags, ['同人'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
