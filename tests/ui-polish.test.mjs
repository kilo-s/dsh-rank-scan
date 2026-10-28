import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { readClientSource } from './_client-source.mjs'

/**
 * 0.6.0 视觉精修整批（plan-0.6.0-polish.md）的永久回归。
 *
 * 分两类：
 *   · **静态结构**：令牌与被改回去最伤人的那几句（C.card 不能又带底色、C.detail 不能又画整圈边框、
 *     链接默认不能有下划线…）—— 这些改回去肉眼很难发现，但会把「一堆小盒子」的感觉整个找回来。
 *   · **行为**：书签排序 / 分批是纯函数，真加载 client/parts 后直接调用，不在测试里复刻一份逻辑。
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const S = readClientSource()

function load() {
  const fakeReact = {
    Component: function Component(props) { this.props = props || {} },
    createElement: function () { return { t: arguments[0], p: arguments[1] || {}, c: Array.prototype.slice.call(arguments, 2) } },
    useState: function (v) { return [typeof v === 'function' ? v() : v, function () {}] },
    useEffect: function () {}, useLayoutEffect: function () {},
    useRef: function (v) { return { current: v } },
    useCallback: function (f) { return f },
    useMemo: function (f) { return f() },
  }
  fakeReact.Component.prototype.setState = function () {}
  let reg = null
  const store = {}
  const sandbox = {
    console: { log: function () {}, info: function () {}, warn: function () {}, error: function () {} },
    localStorage: {
      getItem: function (k) { return k in store ? store[k] : null },
      setItem: function (k, v) { store[k] = String(v) },
      removeItem: function (k) { delete store[k] },
    },
    location: { reload: function () {} },
    document: {
      createElement: function () { return { style: {}, setAttribute: function () {}, remove: function () {} } },
      body: { appendChild: function () {} },
      documentElement: { appendChild: function () {} },
      head: { append: function () {} },
      addEventListener: function () {}, removeEventListener: function () {},
      querySelectorAll: function () { return [] },
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}) } }) },
  }
  sandbox.window = sandbox
  sandbox.window.innerWidth = 1200
  sandbox.window.innerHeight = 800
  sandbox.window.addEventListener = function () {}
  sandbox.window.removeEventListener = function () {}
  sandbox.window.__ModuleLoader__ = { load: function (r) { reg = r } }
  vm.runInContext(readClientSource(), vm.createContext(sandbox), { filename: 'client/parts/*.js' })
  assert.ok(reg && typeof reg.factory === 'function', 'client bundle 没有通过 __ModuleLoader__ 登记工厂')
  return reg.factory(function (spec) {
    if (spec === 'react') return fakeReact
    throw new Error('client bundle 加载期 require 了未声明的模块：' + spec)
  })
}

// ---------------------------------------------------------------- A 令牌
test('A2：C.card 无底色、C.detail 无整圈边框（盒子套盒子不许回来）', () => {
  const card = /card: \{([^}]*)\}/.exec(S)
  assert.ok(card, '找不到 C.card 定义')
  assert.ok(!/background/.test(card[1]), 'C.card 不能有 background（会与 C.detail 叠成一堆盒子）：' + card[1])
  assert.ok(/border: '1px solid '/.test(card[1]), 'C.card 要保留 1px 边框')
  const detail = /detail: \{([^}]*)\}/.exec(S)
  assert.ok(detail, '找不到 C.detail 定义')
  assert.ok(!/border: '1px solid /.test(detail[1]), 'C.detail 不能再画整圈边框：' + detail[1])
  assert.ok(/borderLeft: '2px solid '/.test(detail[1]), 'C.detail 要用左侧 accent 色条表达「这是展开区」')
  assert.ok(/background: T.subtle/.test(detail[1]), 'C.detail 用 T.subtle 底色')
})

test('A3/A4/A5：存在 C.meta / C.sectionLabel / C.itemTitle / C.section 与 T.fs.xs', () => {
  for (const key of ['meta', 'sectionLabel', 'itemTitle', 'section']) {
    assert.ok(new RegExp('\\n      ' + key + ': \\{').test(S), '缺少令牌 C.' + key)
  }
  assert.ok(/fs: \{ xs: '11px'/.test(S), 'T.fs.xs 必须是 11px')
  assert.ok(/row: \{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', margin: '4px 0' \}/.test(S), 'C.row 的间距节奏应为组内 4 / 行间 8')
})

test('A1：链接默认无下划线，hover / focus 才出现；文字动作用 rs-link-action 保留下划线', () => {
  assert.ok(S.includes("'[data-rank-scan-win] a{text-decoration:none}'"), '缺少「a 默认无下划线」规则')
  assert.ok(S.includes("'[data-rank-scan-win] a:hover,[data-rank-scan-win] a:focus-visible{text-decoration:underline;text-underline-offset:2px}'"), '缺少 hover/focus 下划线规则')
  assert.ok(S.includes('.rs-link-action{text-decoration:underline'), '缺少 rs-link-action（文字动作保留下划线）')
  assert.ok(S.includes("className: 'rs-link-action'"), '「新标签打开」这类文字动作要挂 rs-link-action')
})

test('A7：输入框高度与 .rs-btn 对齐为 28px', () => {
  assert.ok(/input: \{ height: '28px'/.test(S), 'C.input 高度必须是 28px')
  assert.ok(/\.rs-btn\{display:inline-flex;align-items:center;justify-content:center;height:28px/.test(S), '.rs-btn 必须是 28px 的 inline-flex')
})

// ---------------------------------------------------------------- B 榜单
test('B1：数字列的 th / td 都右对齐，表头排序按钮靠右（箭头在文字左侧）', () => {
  assert.ok(S.includes("numCol ? { ...C.th, textAlign: 'right' } : C.th"), '数字列表头必须右对齐')
  assert.ok(S.includes("isNumCol(c.key) ? { ...C.td, ...C.num, textAlign: 'right' } : C.td"), '数字列单元格必须右对齐')
  assert.ok(S.includes("numCol ? [arrow, c.label] : [c.label, arrow]"), '数字列表头的箭头必须在文字左侧')
  assert.ok(S.includes('.rs-th-sort.is-num{width:100%;justify-content:flex-end}'), '数字列排序按钮要铺满并靠右')
})

test('B2：变化列 0 仍显示「0」但用 muted，「—」也用 muted（语义不变，只降噪）', () => {
  const mod = load()
  const cell = mod.__test.helpers.cell
  const zero = cell({ key: 'delta' }, { delta: 0 })
  assert.equal(zero.t, 'span', '0 应该渲染成可着色的 span（不再是裸字符串）')
  assert.equal(zero.p.style.color, 'var(--dsw-alias-label-secondary, var(--dsh-text-secondary, rgba(128,128,128,.9)))')
  assert.deepEqual(zero.c, ['0'], '持平仍然必须显示「0」（不能变成「—」）')
  const none = cell({ key: 'delta' }, { delta: null })
  assert.equal(none.t, 'span', '「—」也要走 muted')
  assert.deepEqual(none.c, ['—'])
  const up = cell({ key: 'delta' }, { delta: 3 })
  assert.ok(/\.rs|\^/.test(String(up.p.className || '')) || up.p.style.color !== zero.p.style.color, '涨跌仍要用全色（不能和 0 同色）')
})

test('B3：未收藏的星只在行 hover / 行内 focus / 已展开时显示', () => {
  for (const rule of [
    '[data-rank-scan-win] tbody tr .rs-star.is-off{opacity:0}',
    '[data-rank-scan-win] tbody tr:hover .rs-star.is-off{opacity:.32}',
    '[data-rank-scan-win] tbody tr:focus-within .rs-star.is-off{opacity:.32}',
    '[data-rank-scan-win] tr[aria-expanded="true"] .rs-star.is-off{opacity:.32}',
    '@media (hover:none){[data-rank-scan-win] tbody tr .rs-star.is-off{opacity:.32}}',
  ]) assert.ok(S.includes(rule), '缺少星标可见性规则：' + rule)
  assert.ok(S.includes("className: 'rs-star' + (on ? ' is-on' : ' is-off')"), '星标必须带 rs-star is-on/is-off')
})

test('B4：控件区是「标签在上、控件在下」的网格，榜占两格', () => {
  assert.ok(S.includes("gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))'"), '控件区必须是 auto-fill 网格')
  assert.ok(S.includes("selXS('榜', curBoard || ''"), '榜下拉要保留')
  assert.ok(S.includes('pickBoard, 2)'), '榜的下拉要占两格')
  assert.ok(/label\) \{\s*\n\s*return h\('label', \{ style: \{ display: 'flex', flexDirection: 'column'/.test(S) || S.includes("flexDirection: 'column', gap: '2px', minWidth: 0, gridColumn"), 'selXS 必须是「标签在上」的列布局')
})

test('B7：窄屏卡片第二行改成 C.meta 中点串，不再是一堆 chip', () => {
  const i = S.indexOf('const narrowRow = function (r, i)')
  assert.ok(i > 0, '找不到 narrowRow')
  const body = S.slice(i, i + 3200)
  assert.ok(body.includes("style: { ...C.meta, display: 'flex', flexWrap: 'nowrap'"), '卡片第二行必须走 C.meta')
  assert.ok(!body.includes('style: C.chip'), 'narrowRow 里不许再出现 chip')
  assert.ok(body.includes("' · '"), '要用中点串联')
})

// ---------------------------------------------------------------- C 书签
test('C3：排序纯函数五种口径，null 一律排最后', () => {
  const sortBookmarks = load().__test.sortBookmarks
  const list = [
    { bookKey: 'a', label: 'B书', capturedAt: '2026-10-20T00:00:00.000Z', collect: 5, firstSeen: { dataDate: '2026-10-01' } },
    { bookKey: 'b', label: 'A书', capturedAt: '2026-10-25T00:00:00.000Z', collect: null, firstSeen: null },
    { bookKey: 'c', label: 'C书', capturedAt: null, collect: 99, firstSeen: { dataDate: '2026-10-27' } },
  ]
  // 默认「最近加入」= host 原顺序，一条都不重排
  assert.deepEqual(sortBookmarks(list, 'added').map(function (x) { return x.bookKey }), ['a', 'b', 'c'])
  // 最近更新 ↓：有值的在前，capturedAt=null 的最后
  assert.deepEqual(sortBookmarks(list, 'updated').map(function (x) { return x.bookKey }), ['b', 'a', 'c'])
  // 收藏/在读 ↓：null 的最后
  assert.deepEqual(sortBookmarks(list, 'collect').map(function (x) { return x.bookKey }), ['c', 'a', 'b'])
  // 首次发现 ↓：firstSeen 缺的最后
  assert.deepEqual(sortBookmarks(list, 'firstSeen').map(function (x) { return x.bookKey }), ['c', 'a', 'b'])
  // 书名 ↑
  assert.deepEqual(sortBookmarks(list, 'title').map(function (x) { return x.bookKey }), ['b', 'a', 'c'])
  // 不改入参
  assert.deepEqual(list.map(function (x) { return x.bookKey }), ['a', 'b', 'c'])
})

test('C3：排序状态落 localStorage 的固定键；排序下拉在筛选行', () => {
  assert.ok(S.includes("rank-scan-panel:bm:sort:v1"), '排序偏好键必须是 rank-scan-panel:bm:sort:v1')
  assert.ok(S.includes("'排序：' + o.label"), '筛选行要有「排序」下拉')
  assert.ok(S.includes('BM_SORT_OPTIONS'), '排序选项必须来自 BM_SORT_OPTIONS')
})

test('C4：分批 50 条 + 计数 + 正在编辑的项即使超出已渲染范围也渲染', () => {
  const mod = load()
  const bmBatch = mod.__test.bmBatch
  assert.equal(mod.__test.bmPage, 50, '每批必须是 50 条')
  const many = []
  for (let i = 0; i < 120; i++) many.push({ bookKey: 'k' + i, label: '书' + i })
  const first = bmBatch(many, 50, null)
  assert.equal(first.rows.length, 50)
  assert.equal(first.total, 120)
  assert.equal(first.hasMore, true)
  const all = bmBatch(many, 120, null)
  assert.equal(all.hasMore, false)
  const editing = bmBatch(many, 50, 'k80')
  assert.equal(editing.rows.length, 51, '编辑中的那条要额外渲染出来')
  assert.ok(editing.rows.some(function (b) { return b.bookKey === 'k80' }))
  // 已经在已渲染范围里时不能重复
  const inside = bmBatch(many, 50, 'k3')
  assert.equal(inside.rows.length, 50)
  assert.equal(inside.rows.filter(function (b) { return b.bookKey === 'k3' }).length, 1)
})

test('C4：分批渲染只渲染 batch.rows，且筛选/排序变化时重置回第一批', () => {
  assert.ok(S.includes('batch.rows.map(function (b) {'), '列表必须渲染 batch.rows')
  assert.ok(!S.includes('        list.map(function (b) {'), '不许再全量渲染 list')
  assert.ok(S.includes('React.useEffect(function () { setPageCount(BM_PAGE) }, [flt.q, flt.site, flt.folder, flt.tag, sortKey])'), '筛选/排序变化要重置分批')
  assert.ok(S.includes("'已显示 ' + batch.rows.length + ' / ' + batch.total"), '底部要显示「已显示 x / y」')
  assert.ok(S.includes("'再显示 ' + BM_PAGE + ' 条'"), '底部要有「再显示 50 条」')
})

test('C4：全选与导出「当前筛选」都基于全量筛选结果（不是已渲染的 50 条）', () => {
  assert.ok(S.includes('setSel(list.map(function (b) { return b.bookKey }))'), '全选必须按当前筛选全量')
  const i = S.indexOf('const doExport = function () {')
  assert.ok(i > 0, '找不到 doExport')
  const body = S.slice(i, i + 1200)
  assert.ok(body.includes('sorted.map(function (b) { return b.bookKey })'), '导出「当前筛选」按当前排序顺序，但必须是全量')
  assert.ok(!/batch\.rows/.test(body), '导出不能只看已渲染的那些')
})

test('C1：卡片最多三行（① 标题 ② meta ③ 备注/标签 + 右侧操作）', () => {
  const i = S.indexOf('batch.rows.map(function (b) {')
  assert.ok(i > 0, '找不到卡片渲染')
  const j = S.indexOf("        undo ? h(Banner, { tone: 'warn' },", i)
  const body = S.slice(i, j > i ? j : i + 9000)
  for (const mark of ['/* ① 标题行 */', '/* ② 元信息行', '/* ③ 备注 + 标签/夹']) {
    assert.ok(body.includes(mark), '缺少卡片行标记：' + mark)
  }
  assert.ok(body.includes('C.itemTitle'), '① 书名用 C.itemTitle')
  assert.ok(body.includes('{ ...C.meta,') || body.includes('...C.meta'), '② 元信息用 C.meta')
  assert.ok(body.includes("'打开'") && body.includes("'编辑'"), '③ 行右侧要外露「打开」「编辑」')
  assert.ok(!body.includes("borderStyle: 'dashed'"), "「＋ 备注」不许再用虚线框")
})

test('C5/C6：空筛选有「清除筛选」；批量模式点卡片空白即勾选，批量条 sticky', () => {
  const i = S.indexOf('list.length === 0 ?')
  assert.ok(i > 0, '找不到空态')
  const body = S.slice(i, i + 700)
  assert.ok(body.includes('清除筛选'), '空筛选状态要有「清除筛选」')
  assert.ok(S.includes("if (t && t.closest && t.closest('button,a,input,select,textarea,label')) return"), '批量点选要排除按钮/链接/输入框')
  assert.ok(S.includes("position: 'sticky', top: 0, zIndex: 5"), '批量操作条要 sticky 在顶部')
})

// ---------------------------------------------------------------- A6 按钮层级
test('A6：is-primary 只留给保存 / 扫描这类关键动作', () => {
  const primaries = [...S.matchAll(/className: 'rs-btn is-primary'/g)].length
  const primaryCond = [...S.matchAll(/'rs-btn is-primary'/g)].length
  assert.ok(primaries + primaryCond > 0, '保存类按钮仍应有 is-primary')
  // 明确降级的三个入口不许再回来
  assert.ok(!S.includes("h('button', { className: 'rs-btn is-primary', onClick: function (e) { e.stopPropagation(); if (props.openLink) props.openLink(r.url); else window.open(r.url, '_blank', 'noopener,noreferrer') } }, '在 DSH 侧栏浏览器打开')"), '「在 DSH 侧栏浏览器打开」必须是普通按钮')
  assert.ok(!S.includes("h('button', { className: 'rs-btn is-primary', onClick: function () { setSwitchAsk(null) } }, '继续编辑')"), '「继续编辑」必须是普通按钮')
  assert.ok(!S.includes("h('button', { className: 'rs-btn is-primary', onClick: function () { setLeaveAsk(null) } }, '继续编辑')"), '「继续编辑」（离开确认）必须是普通按钮')
})
