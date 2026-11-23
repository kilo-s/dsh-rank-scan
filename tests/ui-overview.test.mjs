import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readClientSource } from './_client-source.mjs'
import vm from 'node:vm'

/**
 * 0.5.0 概览信息结构守门：
 *   · 四张数字卡在主动作之前；待处理在补全 Banner 之前
 *   · StatCard 恰好 4 处调用；有 onClick 时是 button
 *   · 网格 auto-fit + minmax；空态文案；无变化不渲染分组筛选
 *   · 小尾巴 A：单榜扫描置位 Panel 忙态，409 走 warn；B：输入用 C.input
 */
const s = readClientSource()
const overviewSrc = s.slice(s.indexOf('function Overview'), s.indexOf('function SettingsTab'))
const boardSrc = s.slice(s.indexOf('function BoardTab'), s.indexOf('function Panel(props)'))

function loadComponents() {
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
    document: { visibilityState: 'visible', activeElement: null, addEventListener() {}, removeEventListener() {}, querySelectorAll() { return [] }, querySelector() { return null }, createElement() { return {} } },
    __ModuleLoader__: { load: (r) => { reg = r } },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(s, sandbox, { filename: 'client/parts/*.js' })
  return reg.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require: ' + name) })
}

test('概览顺序：极简态势顶栏在异常与补全之前，待处理在补全 Banner 之前', () => {
  const topAt = overviewSrc.indexOf('/* ① 极简态势顶栏')
  const scanAt = overviewSrc.indexOf('/* ③ 主动作')
  assert.ok(topAt > 0 && scanAt > topAt, '态势顶栏必须在主动作（扫描已选榜）之前')
  const issuesAt = overviewSrc.indexOf('/* ④ 需要处理')
  const enrichAt = overviewSrc.indexOf('/* ⑤ 补全进度')
  assert.ok(issuesAt > 0 && enrichAt > issuesAt, '「需要处理」必须在补全 Banner 之前')
})

test('StatCard 有 onClick 渲染 button，没有渲染 div', () => {
  const mod = loadComponents()
  const withClick = mod.__test.components.StatCard({ label: 'x', value: '1', onClick() {} })
  assert.equal(withClick.type, 'button', '可点卡必须是 button（键盘可聚焦）')
  const plain = mod.__test.components.StatCard({ label: 'x', value: '1' })
  assert.equal(plain.type, 'div', '不可点卡是 div')
})

test('四大平台活卡片网格：宽窗 2×2、窄窗单列；起点与起点图合并为同一平台', () => {
  assert.ok(overviewSrc.includes("gridTemplateColumns: chgNarrow ? '1fr' : 'repeat(2, minmax(0, 1fr))'"), '宽窗 2 列 / 窄窗 1 列')
  const mod = loadComponents()
  const { platformIdOf, shortBoardName, pickHighlights, sortGroupChanges } = mod.__test.helpers
  assert.equal(platformIdOf('qidiantu'), 'qidian', '起点图必须归并到起点平台')
  assert.equal(platformIdOf('qidian'), 'qidian')
  assert.equal(platformIdOf('fanqie'), 'fanqie')
  assert.equal(shortBoardName('qidian.sign.cat12', '签约榜 × 轻小说（移动端口径）'), '轻小说')
  assert.equal(shortBoardName('fanqie.m.new.262', '男频新书榜 × 都市脑洞'), '都市脑洞')
  assert.equal(shortBoardName('qidiantu.shouding', '首订榜'), '首订')
  assert.equal(shortBoardName('ciweimao.buy.latest', '首订（约）', { key: '483' }), '首订·483期')
  const picked = pickHighlights([
    { group: '下降', it: { key: 'a', boardId: 'b1', rank: 10, deltaNum: -3 } },
    { group: '新入榜', it: { key: 'b', boardId: 'b1', rank: 1, deltaNum: null } },
    { group: '上升', it: { key: 'c', boardId: 'b2', rank: 3, deltaNum: 8 } },
    { group: '新入榜', it: { key: 'd', boardId: 'b1', rank: 2, deltaNum: null } },
  ], 3)
  assert.equal(picked.length, 3)
  assert.equal(picked[0].it.key, 'b', '空降第 1 名应排精选首位')
  assert.ok(picked.some(x => x.it.key === 'c'), '应保留不同榜单的高信号飙升')
  // 番茄单日猛涨黑马（+5.7万 #5、同榜 +3.3万 #7）软多样性下可同榜共进，领先低增量榜首（+1.3万 #1）
  const fqPicked = pickHighlights([
    { group: '上升', it: { key: 'small', boardId: 'fq1', rank: 1, deltaNum: 13000, metric: 'value' } },
    { group: '上升', it: { key: 'boom1', boardId: 'fq2', rank: 5, deltaNum: 57000, metric: 'value' } },
    { group: '上升', it: { key: 'boom2', boardId: 'fq2', rank: 7, deltaNum: 33000, metric: 'value' } },
    { group: '上升', it: { key: 'tiny', boardId: 'fq3', rank: 4, deltaNum: 9000, metric: 'value' } },
  ], 3, { platformId: 'fanqie' })
  assert.deepEqual(Array.from(fqPicked, x => x.it.key), ['boom1', 'boom2', 'small'], '软衰减应放行同榜真黑马且按含金量降序')
  // 榜深归一化：起点 20 本榜 #12 空降含金量高于 30 本榜 #28 尾名噪音
  const qdPicked = pickHighlights([
    { group: '上升', it: { key: 'u1', boardId: 'qidian.sign.cat21', rank: 9, deltaNum: 10 } },
    { group: '上升', it: { key: 'u2', boardId: 'qidian.sign.cat12', rank: 11, deltaNum: 9 } },
    { group: '上升', it: { key: 'u3', boardId: 'qidian.sign.cat21', rank: 10, deltaNum: 8 } },
    { group: '上升', it: { key: 'u4', boardId: 'qidian.sign.cat4', rank: 8, deltaNum: 6 } },
    { group: '上升', it: { key: 'u5', boardId: 'qidian.sign.cat12', rank: 10, deltaNum: 5 } },
    { group: '新入榜', it: { key: 'n12', boardId: 'qidian.sign.cat4', rank: 12, deltaNum: null } },
  ], 5, { platformId: 'qidian', boardDepths: { 'qidian.sign.cat21': 20, 'qidian.sign.cat12': 20, 'qidian.sign.cat4': 20 } })
  assert.ok(qdPicked.some(x => x.it.key === 'n12'), '20 本榜 #12 强空降应自然胜出')
  const tailPicked = pickHighlights([
    { group: '上升', it: { key: 'u1', boardId: 'sfacg.vip.week', rank: 8, deltaNum: 9 } },
    { group: '上升', it: { key: 'u2', boardId: 'sfacg.new.click', rank: 11, deltaNum: 3 } },
    { group: '上升', it: { key: 'u3', boardId: 'sfacg.hot.week', rank: 18, deltaNum: 4 } },
    { group: '新入榜', it: { key: 'n28', boardId: 'sfacg.new.click', rank: 28, deltaNum: null } },
  ], 3, { platformId: 'sfacg', boardDepths: { 'sfacg.vip.week': 30, 'sfacg.new.click': 30, 'sfacg.hot.week': 30 } })
  assert.ok(!tailPicked.some(x => x.it.key === 'n28'), '30 本榜尾名 #28 新入榜不硬挤精选席位')
  // 跨榜单视角排序：上升按涨幅降序，新入榜按名次升序
  const sortedUp = sortGroupChanges([
    { group: '上升', it: { key: 'a', boardId: 'fq1', rank: 1, deltaNum: 13600 } },
    { group: '上升', it: { key: 'b', boardId: 'fq4', rank: 5, deltaNum: 56600 } },
    { group: '上升', it: { key: 'c', boardId: 'fq3', rank: 7, deltaNum: 33200 } },
  ], '上升')
  assert.deepEqual(Array.from(sortedUp, x => x.it.key), ['b', 'c', 'a'], '上升视角必须跨榜按涨幅降序')
  const sortedNew = sortGroupChanges([
    { group: '新入榜', it: { key: 'n2', boardId: 'q1', rank: 14 } },
    { group: '新入榜', it: { key: 'n1', boardId: 'q3', rank: 12 } },
  ], '新入榜')
  assert.deepEqual(Array.from(sortedNew, x => x.it.key), ['n1', 'n2'], '新入榜视角必须跨榜按名次升序')
  // 方案 B 纯动态首订竞争：月初大爆发进 3 席，普通单强进 1 席，超平淡日（263）自动降至 0 席；刺猬猫同周 0 席、强新期 2 席
  const qdChanges = [
    { group: '上升', it: { key: 'c1', boardId: 'qidian.sign.cat21', rank: 9, deltaNum: 10 } },
    { group: '上升', it: { key: 'c2', boardId: 'qidian.sign.cat12', rank: 11, deltaNum: 9 } },
    { group: '上升', it: { key: 'c3', boardId: 'qidian.sign.cat21', rank: 10, deltaNum: 8 } },
    { group: '上升', it: { key: 'c4', boardId: 'qidian.sign.cat4', rank: 8, deltaNum: 6 } },
    { group: '上升', it: { key: 'c5', boardId: 'qidian.sign.cat12', rank: 4, deltaNum: 5 } },
    { group: '上升', it: { key: 'c6', boardId: 'qidian.sign.cat4', rank: 7, deltaNum: 4 } },
  ]
  const qdBoom = pickHighlights(qdChanges, 6, {
    platformId: 'qidian',
    batch: { boardId: 'qidiantu.shouding', count: 242, freshForHighlights: true },
    batchItems: [
      { isBatch: true, boardId: 'qidiantu.shouding', it: { key: 'b1', rank: 1, value: 76988 } },
      { isBatch: true, boardId: 'qidiantu.shouding', it: { key: 'b2', rank: 2, value: 6540 } },
      { isBatch: true, boardId: 'qidiantu.shouding', it: { key: 'b3', rank: 3, value: 6435 } },
      { isBatch: true, boardId: 'qidiantu.shouding', it: { key: 'b4', rank: 4, value: 3600 } },
    ],
  })
  assert.equal(qdBoom.filter(x => x.isBatch).length, 3, '起点月初爆发自动拿满 3 席首订上限')
  const qdNormal = pickHighlights(qdChanges, 6, {
    platformId: 'qidian',
    batch: { boardId: 'qidiantu.shouding', count: 32, freshForHighlights: true },
    batchItems: [
      { isBatch: true, boardId: 'qidiantu.shouding', it: { key: 'b1', rank: 1, value: 4676 } },
      { isBatch: true, boardId: 'qidiantu.shouding', it: { key: 'b2', rank: 2, value: 591 } },
    ],
  })
  assert.equal(qdNormal.filter(x => x.isBatch).length, 1, '起点平时仅 1 本高首订只进 1 席，591 自动让位')
  const qdQuiet = pickHighlights(qdChanges, 6, {
    platformId: 'qidian',
    batch: { boardId: 'qidiantu.shouding', count: 21, freshForHighlights: true },
    batchItems: [
      { isBatch: true, boardId: 'qidiantu.shouding', it: { key: 'b1', rank: 1, value: 263 } },
      { isBatch: true, boardId: 'qidiantu.shouding', it: { key: 'b2', rank: 2, value: 75 } },
    ],
  })
  assert.equal(qdQuiet.filter(x => x.isBatch).length, 0, '方案 B：首订超平淡日自动降至 0 席，不硬占位')
  const cwChanges = [
    { group: '上升', it: { key: 'w1', boardId: 'ciweimao.no-vip-click.week', rank: 23, deltaNum: 4 } },
    { group: '上升', it: { key: 'w2', boardId: 'ciweimao.no-vip-click.week', rank: 24, deltaNum: 4 } },
    { group: '上升', it: { key: 'w3', boardId: 'ciweimao.yp_new.week', rank: 18, deltaNum: 2 } },
    { group: '上升', it: { key: 'w4', boardId: 'ciweimao.yp_new.week', rank: 15, deltaNum: 2 } },
    { group: '上升', it: { key: 'w5', boardId: 'ciweimao.no-vip-click.week', rank: 10, deltaNum: 2 } },
    { group: '上升', it: { key: 'w6', boardId: 'ciweimao.no-vip-click.week', rank: 12, deltaNum: 1 } },
  ]
  const cwSameWeek = pickHighlights(cwChanges, 6, {
    platformId: 'ciweimao',
    batch: { boardId: 'ciweimao.buy.latest', count: 16, freshForHighlights: false },
    batchItems: [{ isBatch: true, boardId: 'ciweimao.buy.latest', it: { key: 'cb1', rank: 1, buyNumRaw: '8000+' } }],
  })
  assert.equal(cwSameWeek.filter(x => x.isBatch).length, 0, '刺猬猫同周重复期自动退出精选')
  const cwNewStrong = pickHighlights(cwChanges, 6, {
    platformId: 'ciweimao',
    batch: { boardId: 'ciweimao.buy.latest', count: 16, freshForHighlights: true },
    batchItems: [
      { isBatch: true, boardId: 'ciweimao.buy.latest', it: { key: 'cb1', rank: 1, buyNumRaw: '8000+' } },
      { isBatch: true, boardId: 'ciweimao.buy.latest', it: { key: 'cb2', rank: 2, buyNumRaw: '3700+' } },
      { isBatch: true, boardId: 'ciweimao.buy.latest', it: { key: 'cb3', rank: 3, buyNumRaw: '600+' } },
    ],
  })
  assert.equal(cwNewStrong.filter(x => x.isBatch).length, 2, '刺猬猫强新期当天两本高首订自动胜出，600+ 让位')
})

test('空态文案存在；无变化且无首订时不渲染视角分段筛选', () => {
  assert.ok(overviewSrc.includes('今天还没有采集结果，到计划时刻会自动跑，也可以点「扫描已选榜」'))
  assert.ok(overviewSrc.includes('今天没有榜单变化'))
  assert.ok(overviewSrc.includes("(chgEntries.length || hasAnyBatch) ? h('div',") && overviewSrc.includes("className: 'rs-ov-seg'"), '视角分段筛选只能由变化或首订数据驱动')
})

test('小尾巴 A：单榜扫描置位 Panel 忙态，409 走 warn', () => {
  assert.match(s, /onScanStart: function \(\) \{ postInFlightRef\.current \+= 1; setScanActBusy\(true\) \}/)
  assert.match(s, /onScanEnd: function \(\).*postInFlightRef\.current/)
  assert.match(boardSrc, /toast\('warn', '已有扫描在进行，请等它跑完'\)/)
  assert.match(boardSrc, /e\.status === 409/)
})


test('概览变化列：涨绿跌红、下降不带负号、无差值分组给文案（2026-11-06 统一色）', () => {
  const mod = loadComponents()
  const node = mod.__test.helpers.changeDeltaNode
  assert.equal(typeof node, 'function', '渲染函数要能从测试缝拿到')
  const up = node('上升', { deltaNum: 3, delta: '↑3' })
  const down = node('下降', { deltaNum: -2, delta: '↓2' })
  const flat = node('上升', { deltaNum: 0, delta: '0' })
  const newbie = node('新入榜', { deltaNum: null, delta: '' })
  const rebound = node('回榜', {})
  const out = node('退榜', {})
  assert.equal(up.props.children.join(''), '↑3')
  assert.ok(String(up.props.style.color).indexOf('success') >= 0, '上升必须套绿（C.up）')
  assert.equal(down.props.children.join(''), '↓2', '下降只写绝对值，不许出现 ↓-2')
  assert.ok(String(down.props.style.color).indexOf('error') >= 0, '下降必须套红（C.down）')
  assert.equal(flat.props.children.join(''), '0')
  assert.equal(newbie.props.children.join(''), '＋ 新', '新入榜与榜单页同文案')
  assert.equal(rebound.props.children.join(''), '回榜')
  assert.equal(out.props.children.join(''), '→ 榜外')
  // 老宿主只给字符串：反解出数值后照样上色，且不出现双符号
  const legacy = node('下降', { delta: '↓-2' })
  assert.equal(legacy.props.children.join(''), '↓2')
  assert.ok(String(legacy.props.style.color).indexOf('error') >= 0)
  // 数值型榜（番茄在读/起点图首订）：上升=数值涨，不是名次 ⇒ 用 ± 千分位，不画 ↑↓
  const valUp = node('上升', { deltaNum: 21664, delta: '21664', metric: 'value' })
  const valDown = node('下降', { deltaNum: -13780, delta: '13780', metric: 'value' })
  assert.equal(valUp.props.children.join(''), '+21,664')
  assert.equal(valDown.props.children.join(''), '-13,780')
  assert.ok(String(valDown.props.style.color).indexOf('error') >= 0, '数值下降也要红')
  assert.ok(String(valUp.props.style.color).indexOf('success') >= 0, '数值上升也要绿')
  // 完全没有差值（名额外的榜）⇒ 「—」，不编颜色
  assert.equal(node('上升', {}), '—')
})

test('小尾巴 B：上架日 / 条数输入用 C.input', () => {
  assert.ok(!boardSrc.includes("fontSize: '12px', padding: '2px 4px'"), '不许再写死 12px/padding')
  assert.ok(boardSrc.includes("style: { ...C.input, width: '58px' }"))
  assert.ok(boardSrc.includes("style: { ...C.input, width: 'auto' }"))
})

test('下次计划：今天全跑完时显示明天最早站时刻，且 tone 中性', () => {
  const mod = loadComponents()
  const plan = { enabled: true, waiting: [], fallback: [], siteTimes: { qidian: '01:30', fanqie: '08:30' } }
  const ov = { sites: [{ site: 'qidian', siteName: '起点' }, { site: 'fanqie', siteName: '番茄' }] }
  const r = mod.__test.nextPlanOf(plan, ov, { startedAt: '2026-10-27T16:53:53.543Z' }, 20)
  assert.equal(r.label, '下次计划')
  assert.equal(r.value, '明天 01:30')
  assert.equal(r.sub, '起点')
  assert.equal(r.tone, 'muted')
})

test('下次计划：仅 siteTimes 为空时 label 退回「上次扫描」', () => {
  const mod = loadComponents()
  const plan = { enabled: true, waiting: [], fallback: [], siteTimes: {} }
  const r = mod.__test.nextPlanOf(plan, { sites: [] }, { startedAt: '2026-10-27T16:53:53.543Z' }, 20)
  assert.equal(r.label, '上次扫描')
  assert.notEqual(r.value, '—')
})

test('0 个榜：不渲染平台卡片，给去设置按钮', () => {
  assert.ok(overviewSrc.includes('total > 0 ? (focusPlat ? platformFocusView : platformGridView) : null'))
  assert.ok(overviewSrc.includes('还没有勾选要扫的榜'))
  assert.ok(overviewSrc.includes('去设置勾选'))
})
