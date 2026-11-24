import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import {
  cleanKeywordTags,
  computeBookSeries,
  computeKeywordGraph,
  computeWeeklyRace,
  DEFAULT_OVERVIEW_LAYOUT,
  normalizeOverviewLayout,
  pickCorpusBackfillCandidates,
  sanitizeKeywordText,
  searchLocalBooks,
} from '../lib/scan/overview-analytics.js'
import { readClientSource } from './_client-source.mjs'

function mkTempRoot() {
  return mkdtempSync(join(tmpdir(), 'rs-ov-v2-'))
}

function writeSnap(root, date, boardId, rows, metric = 'value') {
  const dir = join(root, date)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, boardId + '.json'), JSON.stringify({ boardId, dataDate: date, metric, rows }), 'utf8')
}

function loadClientMod() {
  const s = readClientSource()
  let reg = null
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {}, useLayoutEffect: () => {}, useRef: (v) => ({ current: v }),
    useCallback: (fn) => fn, useMemo: (fn) => fn(), Component: function () {}, Fragment: 'Fragment',
  }
  const sandbox = {
    console, Promise, JSON, Math, Number, String, Object, Array, Date, RegExp, Error, AbortController,
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    Event: function Event() {}, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {},
    localStorage: { _m: {}, getItem() { return null }, setItem() {}, removeItem() {} },
    sessionStorage: { _m: {}, getItem() { return null }, setItem() {}, removeItem() {} },
    document: { visibilityState: 'visible', activeElement: null, addEventListener() {}, removeEventListener() {}, querySelectorAll() { return [] }, querySelector() { return null }, createElement() { return {} } },
    __ModuleLoader__: { load: (r) => { reg = r } },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(s, sandbox, { filename: 'client/parts/*.js' })
  return { mod: reg.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require: ' + name) }), src: s }
}

test('画布布局归一化：四站独立半宽卡、v1 自动迁移、保留隐藏/副本并过滤非法项', () => {
  const def = normalizeOverviewLayout(null)
  assert.equal(def.cards.length, DEFAULT_OVERVIEW_LAYOUT.cards.length)
  assert.deepEqual(def.cards.map((c) => c.id), [
    'watch', 'plat-qidian', 'plat-fanqie', 'plat-ciweimao', 'plat-sfacg', 'weekly-race', 'book-compare', 'keywords',
  ])
  assert.equal(def.cards.find((c) => c.id === 'plat-qidian').span, 'half')

  const custom = normalizeOverviewLayout({
    version: 1,
    cards: [
      { id: 'keywords', type: 'keywords', span: 'half', visible: true, config: { days: 14 } },
      { id: 'platforms', type: 'platforms', span: 'full', visible: true },
      { id: 'weekly-race', type: 'weekly-race', span: 'full', visible: false },
      { id: 'bad/../id', type: 'watch', span: 'full', visible: true },
      { id: 'unknown-type', type: 'hack', span: 'full', visible: true },
      { id: 'weekly-race-2', type: 'weekly-race', span: 'half', visible: true, config: { source: 'fanqie', mode: 'daily' } },
    ],
  })
  assert.equal(custom.cards[0].id, 'keywords')
  assert.equal(custom.cards[0].span, 'half')
  assert.equal(custom.cards[0].config.days, 14)
  assert.equal(custom.cards[1].id, 'plat-qidian', 'v1 platforms 应就地拆分为四站独立卡片')
  assert.equal(custom.cards[4].id, 'plat-sfacg')
  assert.equal(custom.cards.find((c) => c.id === 'weekly-race').visible, false, '用户隐藏状态必须保留')
  assert.ok(custom.cards.some((c) => c.id === 'weekly-race-2'), '允许添加的副本卡片应保留')
  assert.ok(!custom.cards.some((c) => c.id === 'bad/../id'), '非法 ID 应被过滤')
  assert.ok(custom.cards.some((c) => c.id === 'book-compare'), '缺失的核心卡自动补回')
})

test('周榜竞速：起点三江多期聚合 + 逐日与累计数组 + 分类过滤', () => {
  const root = mkTempRoot()
  try {
    writeSnap(root, '2026-11-15', 'qidiantu.sanjiang', [
      {
        key: '1001', rank: 1, value: 3000, title: '仙界求生', author: '甲', url: null,
        extra: {
          cat: '玄幻', level: 'Lv.5', collectBase: 10000, totalDelta: 3000, periodStart: '2026-11-08', settledDays: 7,
          daily: [
            { date: '2026-11-09', delta: 500 }, { date: '2026-11-10', delta: 400 },
            { date: '2026-11-11', delta: 600 }, { date: '2026-11-12', delta: 500 },
            { date: '2026-11-13', delta: 400 }, { date: '2026-11-14', delta: 300 },
            { date: '2026-11-15', delta: 300 },
          ],
        },
      },
      {
        key: '1002', rank: 2, value: 1800, title: '大唐医生', author: '乙', url: null,
        extra: {
          cat: '历史', level: 'Lv.4', collectBase: 5000, totalDelta: 1800, periodStart: '2026-11-08', settledDays: 7,
          daily: [
            { date: '2026-11-09', delta: 300 }, { date: '2026-11-10', delta: 300 },
            { date: '2026-11-11', delta: 200 }, { date: '2026-11-12', delta: 200 },
            { date: '2026-11-13', delta: 300 }, { date: '2026-11-14', delta: 250 },
            { date: '2026-11-15', delta: 250 },
          ],
        },
      },
    ])
    writeSnap(root, '2026-11-23', 'qidiantu.sanjiang', [
      {
        key: '2001', rank: 1, value: 1200, title: '新期第一', author: '丙', url: null,
        extra: {
          cat: '仙侠', level: '白金', collectBase: 20000, totalDelta: 1200, periodStart: '2026-11-22', settledDays: 1,
          daily: [{ date: '2026-11-23', delta: 1200 }, { date: '2026-11-24', delta: null }],
        },
      },
    ])

    const latest = computeWeeklyRace(root, { source: 'sanjiang' })
    assert.equal(latest.periods.length, 2)
    assert.equal(latest.period.key, '2026-11-22')
    assert.equal(latest.books[0].title, '新期第一')
    assert.deepEqual(latest.books[0].daily.slice(0, 2), [1200, null])

    const hist = computeWeeklyRace(root, { source: 'sanjiang', period: '2026-11-08' })
    assert.equal(hist.books.length, 2)
    assert.deepEqual(hist.books[0].cumulative, [500, 900, 1500, 2000, 2400, 2700, 3000])

    const histCat = computeWeeklyRace(root, { source: 'sanjiang', period: '2026-11-08', cat: '历史' })
    assert.equal(histCat.books.length, 1)
    assert.equal(histCat.books[0].title, '大唐医生')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('周榜竞速：番茄自然周派生 Top 20 与分类过滤', () => {
  const root = mkTempRoot()
  try {
    // 2026-11-15 周日（基准日），2026-11-16 周一，2026-11-17 周二
    writeSnap(root, '2026-11-15', 'fanqie.m.new.262', [
      { key: '9001', rank: 1, value: 10000, title: '都市系统流', author: 'A', url: null, extra: { catId: 262, wordNumber: 120000 } },
      { key: '9002', rank: 2, value: 8000, title: '修仙长生记', author: 'B', url: null, extra: { catId: 1140, wordNumber: 90000 } },
    ])
    writeSnap(root, '2026-11-16', 'fanqie.m.new.262', [
      { key: '9001', rank: 1, value: 16000, title: '都市系统流', author: 'A', url: null, extra: { catId: 262, wordNumber: 130000 } },
      { key: '9002', rank: 2, value: 10000, title: '修仙长生记', author: 'B', url: null, extra: { catId: 1140, wordNumber: 96000 } },
    ])
    writeSnap(root, '2026-11-17', 'fanqie.m.new.262', [
      { key: '9001', rank: 1, value: 25000, title: '都市系统流', author: 'A', url: null, extra: { catId: 262, wordNumber: 140000 } },
      { key: '9002', rank: 2, value: 11000, title: '修仙长生记', author: 'B', url: null, extra: { catId: 1140, wordNumber: 102000 } },
    ])

    const res = computeWeeklyRace(root, { source: 'fanqie', period: '2026-11-16' })
    assert.equal(res.books.length, 2)
    assert.equal(res.books[0].bookKey, 'fanqie:9001')
    assert.deepEqual(res.books[0].daily.slice(0, 3), [6000, 9000, null])
    assert.deepEqual(res.books[0].cumulative.slice(0, 3), [6000, 15000, null])
    assert.equal(res.books[0].totalDelta, 15000)

    const onlyCat = computeWeeklyRace(root, { source: 'fanqie', period: '2026-11-16', cat: '东方仙侠' })
    assert.equal(onlyCat.books.length, 1)
    assert.equal(onlyCat.books[0].bookKey, 'fanqie:9002')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('多书成长对比与本地搜索：收藏/涨幅%/名次/字数 + 首订毕业点 + URL 解析', () => {
  const root = mkTempRoot()
  try {
    writeSnap(root, '2026-11-20', 'qidian.sign.cat12', [
      { key: '1051', rank: 8, value: null, title: '星际魔女系统', author: '作者甲', url: 'https://www.qidian.com/book/1051/', extra: { collect: 4000, wordsCnt: 100000, cat: '轻小说' } },
    ], 'rank')
    writeSnap(root, '2026-11-21', 'qidian.sign.cat12', [
      { key: '1051', rank: 4, value: null, title: '星际魔女系统', author: '作者甲', url: 'https://www.qidian.com/book/1051/', extra: { collect: 6000, wordsCnt: 115000, cat: '轻小说' } },
    ], 'rank')
    writeSnap(root, '2026-11-22', 'qidiantu.shouding', [
      { key: '1051', rank: 1, value: 1888, title: '星际魔女系统', author: '作者甲', url: 'https://www.qidian.com/book/1051/', extra: { collect: 8000, wordsCnt: 130000, showDate: '2026-11-21' } },
    ], 'value')

    const s = computeBookSeries(root, { bookKeys: ['qidiantu:1051'], days: 30 })
    assert.equal(s.books.length, 1)
    assert.equal(s.books[0].bookKey, 'qidian:1051', 'qidiantu 应归并至 qidian 命名空间')
    assert.equal(s.books[0].points.length, 3)
    assert.equal(s.books[0].points[0].pct, 0)
    assert.equal(s.books[0].points[2].pct, 100)
    assert.equal(s.books[0].shouding.value, 1888)
    assert.equal(s.books[0].shouding.date, '2026-11-21')

    const urlHits = searchLocalBooks(root, 'https://www.qidian.com/book/1051/', 10)
    assert.equal(urlHits[0].bookKey, 'qidian:1051')
    assert.equal(urlHits[0].title, '星际魔女系统')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('关键词生态：PUA 过滤、严格 title+desc 匹配、平方根阻尼与共现余弦', () => {
  const root = mkTempRoot()
  try {
    writeSnap(root, '2026-11-22', 'fanqie.m.new.262', [
      { key: '1', rank: 1, value: 100000, title: '苟道修仙：我的面板能加点', author: 'A', url: null, extra: { desc: '凡人流修仙带系统面板' } },
      { key: '2', rank: 2, value: 40000, title: '系统觉醒：修仙长生路', author: 'B', url: null, extra: { desc: '金手指觉醒系统与长生修仙' } },
      { key: '3', rank: 3, value: 50000, title: '坏字\uE123过滤测试', author: 'C', url: null, extra: { desc: '系统' } },
    ])
    writeSnap(root, '2026-11-22', 'qidian.sign.cat12', [
      { key: '10', rank: 1, value: null, title: '霍格沃茨的魔女魔法师', author: 'D', url: null, extra: { collect: 20000, cat: '轻小说', desc: '哈利波特同人魔法与魔女' } },
    ], 'rank')

    const kw = computeKeywordGraph(root, { days: 30 })
    assert.equal(kw.meta.totalBooks, 3, '含私用区 PUA 乱码的书名必须被过滤')
    assert.ok(kw.nodes['修仙'], '应命中修仙')
    assert.ok(kw.nodes['系统'], '应命中系统')
    assert.ok(!kw.nodes['东京'], '不能因为 cat=轻小说 就误命中东京')
    assert.ok(kw.nodes['系统'].r.some((x) => x[0] === '修仙' && x[1] === 2), '系统与修仙共现 2 本')
    assert.ok(kw.clouds.fanqie.length >= 4)
    assert.ok(kw.clouds.qidian.length >= 2)

    // 按当前启用频道 boards 过滤：取消某频道后立刻剔除历史拖尾，重新勾选即刻恢复
    const kwFanqieOnly = computeKeywordGraph(root, { days: 30, boards: ['fanqie.m.new.262'] })
    assert.equal(kwFanqieOnly.meta.totalBooks, 2, '只勾选番茄频道时应立刻排除起点历史快照')
    assert.equal(kwFanqieOnly.clouds.qidian.length, 0)
    assert.ok(!kwFanqieOnly.nodes['魔女'], '被取消频道独占的词应立刻退出')
    const kwBothBack = computeKeywordGraph(root, { days: 30, boards: ['fanqie.m.new.262', 'qidian.sign.cat12'] })
    assert.equal(kwBothBack.meta.totalBooks, 3, '重新勾选频道后历史快照应立刻恢复且不串缓存')
    assert.ok(kwBothBack.nodes['魔女'])
    const kwNone = computeKeywordGraph(root, { days: 30, boards: [] })
    assert.equal(kwNone.meta.totalBooks, 0, '勾选空清单应返回 0 作品且不报错')

    // 不可信快照（.untrusted.json）统一隔离：新增隔离标记后不得进入搜书、曲线与关键词统计
    writeSnap(root, '2026-11-23', 'sfacg.hot.week', [
      { key: '999', rank: 1, value: 99999, title: '被隔离克苏鲁异界', author: 'X', url: null, extra: { desc: '克苏鲁旧日' } },
    ])
    writeFileSync(join(root, '2026-11-23', 'sfacg.hot.week.untrusted.json'), JSON.stringify({ reason: 'swap' }), 'utf8')
    const kwAfter = computeKeywordGraph(root, { days: 30 })
    assert.ok(!kwAfter.nodes['克苏鲁'], '带 .untrusted.json 隔离标记的快照不得进入关键词统计')
    assert.equal(searchLocalBooks(root, '被隔离克苏鲁', 10).length, 0, '带 .untrusted.json 隔离标记的快照不得进入本地搜书')
    assert.equal(computeBookSeries(root, { bookKeys: ['sfacg:999'], days: 30 }).books[0].points.length, 0, '带 .untrusted.json 隔离标记的快照不得进入多书曲线')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('客户端纯函数与无 DOM 安全渲染：中心枢纽零偏移、零重叠、无右下角浮层说明', () => {
  const { mod, src } = loadClientMod()
  const { normalizeOvLayout, reorderOvCards, prepareKwModel, buildKwBackboneTree, packKwWordCloud } = mod.__test.helpers
  const { WeeklyRaceCard, BookCompareCard, KeywordAnalysisCard, OverviewCardShell, OverviewCanvasPicker, Overview } = mod.__test.components

  // 1. 布局重排纯函数
  const init = normalizeOvLayout(null)
  const reordered = reorderOvCards(init.cards, 'keywords', 'watch')
  assert.equal(reordered[0].id, 'keywords')
  assert.equal(init.cards[0].id, 'watch', '重排不能原地修改原数组')

  // 2. 枢纽衍生树：RADII[0]===0 中心锁死 (480, 260) 且零气泡重叠
  const fakeNodes = {
    系统: { n: 80, heat: 8.5, top1: 8, dom: 'qidian', sc: [30, 45, 5, 0], ss: [3.2, 4.1, 1.2, 0], p: null, sb: '书A', r: [['修仙', 15, 0.25, '书A'], ['觉醒', 20, 0.3, '书B'], ['病娇', 10, 0.18, '书C'], ['魔法', 12, 0.2, '书D']] },
    修仙: { n: 60, heat: 6.2, top1: 10, dom: 'fanqie', sc: [35, 25, 0, 0], ss: [3.6, 2.6, 0, 0], p: null, sb: '书A', r: [['系统', 15, 0.25, '书A'], ['长生', 18, 0.32, '书E'], ['苟道', 12, 0.26, '书F']] },
    长生: { n: 30, heat: 3.1, top1: 12, dom: 'qidian', sc: [10, 20, 0, 0], ss: [1.1, 2.0, 0, 0], p: '修仙', sb: '书E', r: [['修仙', 18, 0.32, '书E']] },
    苟道: { n: 22, heat: 2.0, top1: 18, dom: 'qidian', sc: [6, 16, 0, 0], ss: [0.6, 1.4, 0, 0], p: '修仙', sb: '书F', r: [['修仙', 12, 0.26, '书F']] },
    觉醒: { n: 45, heat: 4.5, top1: 9, dom: 'qidian', sc: [20, 25, 0, 0], ss: [2.0, 2.5, 0, 0], p: '系统', sb: '书B', r: [['系统', 20, 0.3, '书B']] },
    病娇: { n: 40, heat: 4.0, top1: 11, dom: 'fanqie', sc: [30, 5, 0, 5], ss: [2.5, 0.4, 0, 1.1], p: null, sb: '书C', r: [['系统', 10, 0.18, '书C'], ['反派', 14, 0.29, '书G']] },
    反派: { n: 32, heat: 4.8, top1: 20, dom: 'sfacg', sc: [15, 5, 2, 10], ss: [1.0, 0.3, 0.4, 3.1], p: '病娇', sb: '书G', r: [['病娇', 14, 0.29, '书G']] },
    魔法: { n: 42, heat: 5.1, top1: 15, dom: 'sfacg', sc: [12, 18, 1, 11], ss: [1.1, 1.5, 0.2, 2.3], p: null, sb: '书D', r: [['系统', 12, 0.2, '书D']] },
    独苗飙升: { n: 1, heat: 12.0, top1: 100, dom: 'fanqie', sc: [1, 0, 0, 0], ss: [12.0, 0, 0, 0], p: null, sb: '书Z', r: [] },
  }
  const model = prepareKwModel(fakeNodes)
  assert.equal(model.quickRoots[0], '系统', '动态中心枢纽第 1 名应为桥梁与热度综合最高的词')
  assert.ok(!model.quickRoots.includes('独苗飙升'), '单书拉高词不应挤占前 8 动态中心枢纽（当多书真风口已够 8 个时）')
  assert.equal(model.defaultRootId, model.byName['系统'], '默认中心应跟随动态 Top 1 枢纽')
  const tree = buildKwBackboneTree(model, model.byName['系统'])
  const rootNd = tree.nodeById[model.byName['系统']]
  assert.equal(rootNd.x, 480, '中心枢纽 X 必须锁定画布正中 480')
  assert.equal(rootNd.y, 260, '中心枢纽 Y 必须锁定画布正中 260')
  assert.equal(tree.gNodes.length, Object.keys(fakeNodes).length, '所有节点应单连通入树，零孤岛')
  for (let i = 0; i < tree.gNodes.length; i++) {
    for (let j = i + 1; j < tree.gNodes.length; j++) {
      const a = tree.gNodes[i], b = tree.gNodes[j]
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      assert.ok(dist >= a.r + b.r - 0.5, '气泡不应重叠: ' + a.t.k + ' vs ' + b.t.k)
    }
  }

  // 3. 词云螺旋排布：零矩形碰撞且支持多书/少书筛选
  const packed = packKwWordCloud([
    ['系统', 4.2, 60, 8, '书1', 50000],
    ['修仙', 3.5, 50, 9, '书2', 40000],
    ['冷门飙升', 1.8, 1, 100, '书3', 90000],
  ], 'all')
  assert.equal(packed.placed.length, 3)
  assert.equal(packKwWordCloud([['系统', 4.2, 60, 8, '书1', 50000], ['冷门飙升', 1.8, 1, 100, '书3', 90000]], 'multi').placed.length, 1)
  assert.equal(packKwWordCloud([['系统', 4.2, 60, 8, '书1', 50000], ['冷门飙升', 1.8, 1, 100, '书3', 90000]], 'mono').placed.length, 1)

  // 4. 无 DOM 空数据渲染不抛异常
  assert.ok(WeeklyRaceCard({ narrow: false, rev: '1' }))
  assert.ok(BookCompareCard({ narrow: false, rev: '1', seedBooks: [] }))
  assert.ok(KeywordAnalysisCard({ narrow: false, rev: '1' }))
  assert.ok(OverviewCardShell({ card: init.cards[0], narrow: false }))
  assert.ok(OverviewCanvasPicker({ layout: init }))
  assert.ok(Overview({ ov: { dataDate: '2026-11-23', counts: { ok: 1 }, sites: [] }, width: 900, rev: '1', reload() {}, act() {} }))

  // 5. 回归检查：已按要求移除右下角 100% 缩放角标与教程说明，且树与词云 SVG 严格区分 key 防叠加
  const kwSrc = src.slice(src.indexOf('function KeywordAnalysisCard'), src.indexOf('const OV_PLAT_CARD_TYPES'))
  assert.ok(!kwSrc.includes('zoom-badge'), '不应存在右下角缩放角标')
  assert.ok(!kwSrc.includes('单击查溯源与共现'), '不应存在右下角冗长教程说明')
  assert.ok(!kwSrc.includes('单击左侧细词锁定，再点展树'), '不应存在词云右下角填充说明')
  assert.ok(kwSrc.includes("key: 'kw-svg-tree'") && kwSrc.includes("key: 'kw-svg-cloud-'"), '树视图与词云 SVG 必须独立 key，防止 React 复用导致两图重叠')
  assert.ok(src.includes('if (vp.parentNode === svg) svg.removeChild(vp)'), '树卸载时必须清理命令式追加的 DOM 子树')
  assert.ok(!src.includes('＋ 周榜竞速') && !src.includes('＋ 作品对比'), '卡片管理弹窗底部不应出现重复的添加加号按钮')
})

test('关键词语料补齐与去噪：接入双缓存 desc/tags、屏蔽平台模板词与否定词、首订榜用收藏权重与覆盖率统计', () => {
  assert.deepEqual(
    cleanKeywordTags(['男频', '女频', '签约', 'VIP付费', '无系统', '无后宫', '多女主', '赛博朋克', '多女主']),
    ['多女主', '赛博朋克'],
  )
  assert.ok(!sanitizeKeywordText('这是一本无系统、没有金手指的纯修仙小说').includes('系统'))
  assert.ok(sanitizeKeywordText('这是一本无系统、没有金手指的纯修仙小说').includes('修仙'))
  assert.ok(sanitizeKeywordText('无敌流主角').includes('无敌'), '无敌流不应被否定词正则误剥')

  const root = mkTempRoot()
  try {
    writeSnap(root, '2026-11-24', 'ciweimao.yp_new.week', [
      { key: '1001', rank: 1, value: null, title: '普通书名甲', author: 'A', url: null, extra: { collect: 9000 } },
    ], 'rank')
    writeSnap(root, '2026-11-24', 'sfacg.hot.week', [
      { key: '2001', rank: 1, value: null, title: '普通书名乙', author: 'B', url: null, extra: { collect: 8000 } },
      { key: '2002', rank: 2, value: null, title: '普通书名丙', author: 'C', url: null, extra: { collect: 3000 } },
    ], 'rank')
    writeSnap(root, '2026-11-24', 'qidiantu.shouding', [
      { key: '3001', rank: 1, value: 180, title: '普通书名丁', author: 'D', url: null, extra: { collect: 25000 } },
    ], 'value')

    mkdirSync(join(root, 'state'), { recursive: true })
    writeFileSync(join(root, 'state', 'book-page-cache.json'), JSON.stringify({
      version: 1,
      entries: {
        'ciweimao:1001': {
          collect: 9000, words: 120000, title: null, author: null, score: null, fetchedAt: '2026-11-24T00:00:00Z',
          desc: '无系统无后宫，纯粹的崩坏世界冒险故事',
          tags: ['男频', '刺猬猫首发', '女频', '无系统', '星铁'],
        },
        'sfacg:2001': {
          collect: 8000, words: 90000, title: null, author: null, score: null, fetchedAt: '2026-11-24T00:00:00Z',
          desc: '',
          tags: ['VIP付费', '橘味', '变身'],
        },
      },
    }), 'utf8')
    writeFileSync(join(root, 'state', 'qidian-book-cache.json'), JSON.stringify({
      version: 1,
      books: {
        '3001': {
          collect: 25000, wordsCnt: 150000, title: '普通书名丁', fetchedAt: '2026-11-24T00:00:00Z',
          desc: '夜之城义体改造故事',
          tags: ['签约', '赛博朋克'],
        },
      },
    }), 'utf8')

    const kw = computeKeywordGraph(root, { days: 30 })
    assert.equal(kw.meta.totalBooks, 4)
    assert.ok(kw.nodes['崩坏'], '应命中 book-page-cache 的简介词')
    assert.ok(kw.nodes['星铁'], '应命中 book-page-cache 的清洗后标签')
    assert.ok(kw.nodes['轻百橘味'] && kw.nodes['变身'], '应命中菠萝包缓存标签')
    assert.ok(kw.nodes['赛博朋克'], '应命中 qidian-book-cache 的简介与标签')
    assert.ok(!kw.nodes['系统'], '否定词「无系统」绝不能反向误中系统')
    assert.ok(!kw.nodes['多女主'], '否定词「无后宫」绝不能反向误中多女主')
    assert.ok(!kw.nodes['穿书女频'], '平台模板标签「女频」绝不能误中穿书女频')
    const qdCyber = kw.clouds.qidian.find((x) => x[0] === '赛博朋克')
    assert.ok(qdCyber && qdCyber[5] === 25000, '起点首订榜作品热度口径应取收藏 25000 而非首订 180')
    assert.equal(kw.meta.coverage.withText, 3, '4 本书中应有 3 本含简介或标签')
    assert.equal(kw.meta.coverage.pct, 75)
    assert.equal(kw.meta.coverage.bySite.sfacg.withText, 1)
    assert.equal(kw.meta.coverage.bySite.sfacg.total, 2)
    assert.equal(kw.meta.coverage.bySite.sfacg.pct, 50)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('1B 低速增量语料补缺候选挑选：按菠萝包>刺猬猫>三江>首订>其余排序，跳过已覆盖/隔离/冷却项', () => {
  const root = mkTempRoot()
  try {
    writeSnap(root, '2026-11-24', 'fanqie.m.new.262', [
      { key: '1', rank: 1, value: 90000, title: '番茄缺简介', author: 'A', url: null, extra: {} },
      { key: '2', rank: 2, value: 80000, title: '番茄已有简介', author: 'A', url: null, extra: { desc: '已有简介' } },
    ])
    writeSnap(root, '2026-11-24', 'qidiantu.shouding', [
      { key: '301', rank: 1, value: 500, title: '首订缺简介', author: 'B', url: null, extra: { collect: 5000 } },
    ])
    writeSnap(root, '2026-11-24', 'qidiantu.sanjiang', [
      { key: '302', rank: 1, value: 2000, title: '三江缺简介', author: 'C', url: null, extra: { collectBase: 10000, totalDelta: 2000 } },
    ])
    writeSnap(root, '2026-11-24', 'ciweimao.yp_new.week', [
      { key: '401', rank: 1, value: null, title: '猫缺简介', author: 'D', url: null, extra: { collect: 4000 } },
    ], 'rank')
    writeSnap(root, '2026-11-23', 'sfacg.new.click', [
      { key: '501', rank: 2, value: null, title: '包第二（昨日分时快照）', author: 'E', url: null, extra: { collect: 2000 } },
      { key: '502', rank: 1, value: null, title: '包第一冷却', author: 'E', url: null, extra: { collect: 3000 } },
    ], 'rank')
    writeSnap(root, '2026-11-24', 'sfacg.vip.week', [
      { key: '599', rank: 1, value: null, title: '隔离榜书', author: 'F', url: null, extra: {} },
    ], 'rank')
    writeFileSync(join(root, '2026-11-24', 'sfacg.vip.week.untrusted.json'), JSON.stringify({ reason: 'swap' }), 'utf8')

    const cands = pickCorpusBackfillCandidates(root, { limit: 10, skipKeys: new Set(['sfacg:502']) })
    assert.deepEqual(
      cands.map((c) => c.bookKey),
      ['sfacg:501', 'ciweimao:401', 'qidian:302', 'qidian:301', 'fanqie:1'],
      '优先级应为 菠萝包 > 刺猬猫 > 三江 > 首订 > 番茄，且排除已有简介、冷却与隔离榜',
    )
    assert.equal(pickCorpusBackfillCandidates(root, { limit: 2 }).length, 2, '必须严格受单轮上限约束')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('作品成长对比 2A：智能双 Y 轴（在读 vs 收藏）与 Log10 对数刻度纯函数', () => {
  const { mod } = loadClientMod()
  const { chartLogTicks, buildCompareAxes } = mod.__test.helpers

  // 1. 对数刻度：紧贴边界、严格递增、单值不 NaN
  const ltWide = chartLogTicks(3000, 200000)
  assert.ok(ltWide.length >= 3 && ltWide.length <= 6)
  assert.ok(ltWide[0] <= 3000 && ltWide[ltWide.length - 1] >= 200000)
  for (let i = 1; i < ltWide.length; i++) assert.ok(ltWide[i] > ltWide[i - 1])
  const ltSingle = chartLogTicks(5000, 5000)
  assert.ok(ltSingle.length >= 2 && ltSingle[0] < 5000 && ltSingle[ltSingle.length - 1] > 5000)

  const fqBook = { bookKey: 'fanqie:1', site: 'fanqie', siteName: '番茄', title: '番茄书', points: [{ date: '2026-11-20', value: 60000, pct: 0, rank: 5 }, { date: '2026-11-24', value: 240000, pct: 300, rank: 1 }] }
  const qdBook = { bookKey: 'qidian:2', site: 'qidian', siteName: '起点', title: '起点书', points: [{ date: '2026-11-20', value: 2000, pct: 0, rank: 10 }, { date: '2026-11-24', value: 8000, pct: 300, rank: 3 }] }
  const cwBook = { bookKey: 'ciweimao:3', site: 'ciweimao', siteName: '刺猬猫', title: '猫书', points: [{ date: '2026-11-20', value: 1000, pct: 0, rank: 8 }, { date: '2026-11-24', value: 100000, pct: 9900, rank: 1 }] }

  // 2. 跨站（在读+收藏）自动启用双轴，起点曲线不再贴底
  const dual = buildCompareAxes([fqBook, qdBook], 'value', 'linear', { vh: 216, padB: 26 })
  assert.equal(dual.isDual, true)
  assert.equal(dual.useLog, false)
  assert.equal(dual.padR, 54)
  assert.equal(dual.left.label, '在读')
  assert.equal(dual.right.label, '收藏')
  assert.equal(dual.sideOfBook(fqBook), 'left')
  assert.equal(dual.sideOfBook(qdBook), 'right')
  const qdHighY = dual.yAtBook(qdBook, 8000)
  const qdLowY = dual.yAtBook(qdBook, 2000)
  assert.ok(qdLowY - qdHighY > dual.plotH * 0.5, '启用右轴后，收藏曲线应展开占满可视高度而不是被压扁贴底')

  // 3. 同量纲自动退回单左轴
  const single = buildCompareAxes([qdBook, cwBook], 'value', 'linear', { vh: 216, padB: 26 })
  assert.equal(single.isDual, false)
  assert.equal(single.right, null)
  assert.equal(single.padR, 18)

  // 4. 对数刻度：等倍增长等距，<=0 安全返回 null
  const logAx = buildCompareAxes([cwBook], 'value', 'log', { vh: 216, padB: 26 })
  assert.equal(logAx.useLog, true)
  assert.equal(logAx.yAtBook(cwBook, 0), null)
  assert.equal(logAx.yAtBook(cwBook, -10), null)
  const y1k = logAx.yAtBook(cwBook, 1000)
  const y10k = logAx.yAtBook(cwBook, 10000)
  const y100k = logAx.yAtBook(cwBook, 100000)
  assert.ok(Math.abs((y1k - y10k) - (y10k - y100k)) < 0.05, '对数轴上 1k→1w 与 1w→10w 两个十倍跨度必须等距')

  // 5. 涨幅% 与 名次 强制保持线性单轴
  const pctAx = buildCompareAxes([fqBook, qdBook], 'pct', 'log', { vh: 216, padB: 26 })
  assert.equal(pctAx.isDual, false)
  assert.equal(pctAx.useLog, false)
  const rkAx = buildCompareAxes([fqBook, qdBook], 'rank', 'log', { vh: 216, padB: 26 })
  assert.equal(rkAx.isDual, false)
  assert.equal(rkAx.useLog, false)
  assert.equal(rkAx.invertY, true)
})

test('作品成长对比交互与配置回显：键名归一化、异步 /layout 回填、可取消已选、删空不复活', () => {
  const { mod, src } = loadClientMod()
  const { normOvBookKey, dedupeCompareKeys } = mod.__test.helpers
  assert.equal(normOvBookKey('qidiantu:1049003034'), 'qidian:1049003034')
  assert.equal(normOvBookKey('ciweimao:100508295'), 'ciweimao:100508295')
  assert.deepEqual(
    Array.from(dedupeCompareKeys(['qidiantu:101', 'qidian:101', 'fanqie:202', 'ciweimao:303', ''])),
    ['qidian:101', 'fanqie:202', 'ciweimao:303'],
    '跨源起点图与起点同书号必须归一化去重，确保移除按钮总能命中',
  )
  assert.equal(dedupeCompareKeys(Array.from({ length: 12 }, (_, i) => 'fanqie:' + i)).length, 8, '最多保留 8 本')

  // 用真实有状态 mini-React 驱动 BookCompareCard，验证：
  // 1) layoutLoaded=false 时不抢跑自动填 3 本；
  // 2) layoutRev 到达后完整回显磁盘保存的 compareKeys 与 yScale；
  // 3) 点芯片 × 与「清空」均可正常删除并落盘 compareTouched=true，重开空态不再强制复活默认 3 本
  const calls = []
  let reg = null
  const states = []
  const refs = []
  const effects = []
  let sIdx = 0
  let rIdx = 0
  const miniReact = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    useState: (init) => {
      const i = sIdx++
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init
      const set = (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v }
      return [states[i], set]
    },
    useRef: (init) => {
      const i = rIdx++
      if (!(i in refs)) refs[i] = { current: init }
      return refs[i]
    },
    useEffect: (fn, deps) => { effects.push({ fn, deps }) },
    useLayoutEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    Component: function () {},
    Fragment: 'Fragment',
  }
  const sandbox = {
    console, Promise, JSON, Math, Number, String, Object, Array, Date, RegExp, Error,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    fetch: async (u) => {
      calls.push(String(u))
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, items: [{ bookKey: 'fanqie:999', title: '默认书' }], books: [], dates: [] }) }
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { createElement: () => ({ style: {}, setAttribute: () => {}, remove: () => {} }), head: { appendChild: () => {} }, body: { appendChild: () => {} }, addEventListener: () => {}, removeEventListener: () => {}, querySelectorAll: () => [] },
    __ModuleLoader__: { load: (r) => { reg = r } },
  }
  sandbox.window = sandbox
  sandbox.window.addEventListener = () => {}
  sandbox.window.removeEventListener = () => {}
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'client/parts/*.js' })
  const m2 = reg.factory((id) => { if (id === 'react') return miniReact; throw new Error(id) })
  const { BookCompareCard } = m2.__test.components

  const renderCard = (props) => {
    sIdx = 0; rIdx = 0; effects.length = 0
    const tree = BookCompareCard(props)
    const runEffects = effects.slice()
    for (const ef of runEffects) ef.fn()
    return tree
  }
  const findAll = (node, pred, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (Array.isArray(node)) { node.forEach((c) => findAll(c, pred, out)); return out }
    if (pred(node)) out.push(node)
    if (node.props && node.props.children) findAll(node.props.children, pred, out)
    return out
  }

  const persisted = []
  // 阶段 1：/layout 尚未返回（layoutLoaded=false），绝不抢跑填充默认 3 本
  renderCard({
    config: { xAxis: 'date', yAxis: 'value', days: 30, compareKeys: [] },
    layoutLoaded: false, layoutRev: 0, watchReady: true, seedBooks: ['fanqie:1', 'fanqie:2', 'fanqie:3'],
    onConfigChange: (p) => persisted.push(p),
  })
  assert.deepEqual(Array.from(states[0].keys), [], '/layout 到达前不应抢跑回填默认书单')

  // 阶段 2：/layout 返回用户已保存的 2 本书（含刺猬猫与 qidiantu 归一化）及 log 刻度
  renderCard({
    config: { xAxis: 'date', yAxis: 'value', yScale: 'log', days: 14, compareKeys: ['qidiantu:101', 'ciweimao:100508295'], compareTouched: true },
    layoutLoaded: true, layoutRev: 1, watchReady: true, seedBooks: ['fanqie:1', 'fanqie:2', 'fanqie:3'],
    onConfigChange: (p) => persisted.push(p),
  })
  assert.deepEqual(Array.from(states[0].keys), ['qidian:101', 'ciweimao:100508295'], '必须完整回显已保存的书单并归一化')
  assert.equal(states[0].yScale, 'log')
  assert.equal(states[0].days, 14)

  // 阶段 3：重绘出芯片后点 × 删除第一本，再点「清空」
  const tree2 = renderCard({
    config: { xAxis: 'date', yAxis: 'value', yScale: 'log', days: 14, compareKeys: ['qidiantu:101', 'ciweimao:100508295'], compareTouched: true },
    layoutLoaded: true, layoutRev: 1, watchReady: true, seedBooks: ['fanqie:1', 'fanqie:2', 'fanqie:3'],
    onConfigChange: (p) => persisted.push(p),
  })
  const closeBtns = findAll(tree2, (n) => n.type === 'button' && n.props && n.props.className === 'rs-ov-chip-x')
  assert.equal(closeBtns.length, 2, '每个已选书号都必须直接渲染可点的 × 移除按钮')
  closeBtns[0].props.onClick({ stopPropagation() {} })
  assert.deepEqual(Array.from(states[0].keys), ['ciweimao:100508295'])
  assert.deepEqual(Array.from(persisted[persisted.length - 1].compareKeys), ['ciweimao:100508295'])
  assert.equal(persisted[persisted.length - 1].compareTouched, true)

  const clearBtn = findAll(tree2, (n) => n.type === 'button' && n.props && n.props.title === '清空全部已选对比作品')[0]
  assert.ok(clearBtn, '已选区应提供统一风格的「清空」按钮')
  clearBtn.props.onClick()
  assert.deepEqual(Array.from(states[0].keys), [])
  assert.equal(persisted[persisted.length - 1].compareTouched, true)

  // 阶段 4：清空后再次渲染（模拟关掉重开，config 为 compareKeys=[], compareTouched=true），绝不再强行塞回默认 3 本
  renderCard({
    config: { xAxis: 'date', yAxis: 'value', days: 14, compareKeys: [], compareTouched: true },
    layoutLoaded: true, layoutRev: 2, watchReady: true, seedBooks: ['fanqie:1', 'fanqie:2', 'fanqie:3'],
    onConfigChange: (p) => persisted.push(p),
  })
  assert.deepEqual(Array.from(states[0].keys), [], '用户主动清空后重开必须保持空态，不再塞回默认 3 本')

  // 回归检查：三张分析卡全部接入 layoutLoaded / layoutRev
  assert.ok(src.includes('layoutLoaded: ui.layoutLoaded, layoutRev: ui.layoutRev'))
  assert.ok(src.includes("className: 'rs-ov-dir-row' + (already ? ' is-sel' : '')"), '下拉已选项应可点击切换并带统一选中态样式')
})
