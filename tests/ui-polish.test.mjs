import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
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
/** 宿主侧源码：条数口径（canDepth）在 src/index.ts 的 catalog() 里 */
const HOST = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')

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
  assert.ok(body.includes("metaDot('sep' + k)"), '要用中点串联（metaDot）')
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

// ---------------------------------------------------------------- 0.6.0 复查补丁
test('中点串：分隔符是「 · 」且两边留 4px（metaDot），不靠空格', () => {
  const mod = load()
  const metaDot = mod.__test.helpers.metaDot
  assert.equal(typeof metaDot, 'function', 'metaDot 必须导出为纯函数')
  const dot = metaDot('k1')
  assert.equal(dot.t, 'span', '中点必须是独立 span（flex 子节点的首尾空格会被裁掉）')
  assert.deepEqual(dot.c, ['·'], '内容必须是中点本身')
  assert.equal(dot.p.style.margin, '0 4px', '中点两边必须留 4px（不能靠空格）')
  assert.equal(dot.p.style.color, 'var(--dsw-alias-label-secondary, var(--dsh-text-secondary, rgba(128,128,128,.9)))', '中点要用 T.muted')
  // 两处元信息行都必须走 metaDot，不许再手写 ' · ' 分隔
  assert.ok(S.includes("metaDot('ms' + k)"), '书签卡片的中点串必须用 metaDot')
  assert.ok(S.includes("metaDot('sep' + k)"), '窄屏榜单卡片的中点串必须用 metaDot')
  const leftovers = (S.match(/style: \{ opacity: 0\.6 \}, ' · '/g) || []).length
  assert.equal(leftovers, 0, '不许留下手写的中分隔符（会被 flex 吃掉空格）')
})

test('备注文字：button 语义 + 常规字重 + 正文色，只在 hover / focus-visible 出下划线', () => {
  assert.ok(S.includes('.rs-note-text{border:none;background:transparent;padding:0;cursor:pointer;font:inherit;font-weight:400;text-decoration:none;color:'), '缺少 .rs-note-text 基础规则（无下划线 + 常规字重 + 正文色）')
  assert.ok(S.includes('.rs-note-text:hover,.rs-note-text:focus-visible{text-decoration:underline'), 'hover / focus-visible 才出下划线')
  assert.ok(S.includes("className: 'rs-note-text'"), '有备注的文字必须用 rs-note-text（不是 rs-link-action）')
  const i = S.indexOf("className: 'rs-note-text'")
  const around = S.slice(Math.max(0, i - 400), i + 400)
  assert.ok(around.includes("h('button'"), '仍然是 button 语义（不是 a）')
  assert.ok(S.includes("'＋ 备注'"), '空状态「＋ 备注」保持原样')
})

test('回归：卡片状态样式不许写 xxx: cond ? a : undefined（会把 C.card 的 border 整条清空）', () => {
  const i = S.indexOf('const narrowRow = function (r, i)')
  assert.ok(i > 0, '找不到 narrowRow')
  const body = S.slice(i, i + 3200)
  assert.ok(!/^ {10,}borderColor: /m.test(body), '窄屏卡片不许再写 borderColor: … : undefined —— React 落成空串会把 border 长写清空，边框退回 currentColor（暗色下是亮白）')
  assert.ok(body.includes("style: open\n", ) || body.includes('style: open\n            ?'), '展开态应整体替换 style')
  const i2 = S.indexOf("data-row-idx': i,")
  assert.ok(i2 > 0, '找不到表格行')
  const rowBody = S.slice(i2, i2 + 600)
  assert.ok(!/background:\s*open\s*\?\s*T\.subtle\s*:\s*undefined/.test(rowBody), '表格行也不许用 background: … : undefined')
})

// ---------------------------------------------------------------- 0.6 收尾（0.7 前）
test('起点简介：去全角空格与空行；没有简介时整块不渲染（不显示「—」）', () => {
  const cleanDesc = load().__test.helpers.cleanDesc
  assert.equal(typeof cleanDesc, 'function', 'cleanDesc 必须是纯函数')
  assert.equal(cleanDesc('\u3000\u3000最近不知怎么回事，灵气复苏了？\n\n不对！'), '最近不知怎么回事，灵气复苏了？\n不对！', '去掉首尾全角空格与空行')
  assert.equal(cleanDesc('  第一段  \n \n 第二段  '), '第一段\n第二段', '压掉空行、去每行首尾空白')
  assert.equal(cleanDesc(null), '', 'null ⇒ 空串')
  assert.equal(cleanDesc(''), '', '空串 ⇒ 空串')
  assert.equal(cleanDesc('\u3000 \n \n '), '', '只有空白 ⇒ 空串（调用方不得渲染「—」）')
  // 组件结构：无值时提前 return null；默认 3 行 clamp + 展开/收起
  const i = S.indexOf('function BoardDesc(props)')
  assert.ok(i > 0, '找不到 BoardDesc')
  const body = S.slice(i, i + 2200)
  assert.ok(body.includes('if (!text) return null'), '没有简介时必须整块返回 null')
  assert.ok(body.includes('WebkitLineClamp: 3'), '默认最多 3 行')
  assert.ok(body.includes("'展开简介'") && body.includes("'收起简介'"), '要有展开/收起')
  // 详情卡里必须挂上（宽表与窄卡片共用同一个 detailCard）
  const d = S.indexOf('const detailCard = function (r)')
  assert.ok(d > 0, '找不到 detailCard')
  assert.ok(S.slice(d, d + 1200).includes('h(BoardDesc, { text: ex.desc })'), '详情卡必须渲染简介块')
})

test('0.6 收尾补列：空值显示「—」、数字列右对齐、480 卡片中点串带上新列', () => {
  const mod = load()
  const cell = mod.__test.helpers.cell
  // 空值一律「—」，不补 0
  for (const key of ['shouding', 'firstDay', 'firstV']) {
    assert.equal(cell({ key: key }, { extra: {} }), '—', key + ' 空值必须是「—」，不许补 0')
  }
  assert.equal(cell({ key: 'shouding' }, { extra: { shouding: 2168 } }), 2168, '首订有值时原样显示')
  // ★ 0.6 修正：这一列是时间戳（站点「日期」列），不再是「+1148」那种增量
  assert.equal(cell({ key: 'firstDay' }, { extra: { firstDay: 1793000228 } }), '10-26 15:37', '时间戳列显示 MM-DD HH:mm')
  assert.equal(cell({ key: 'firstV' }, { extra: { firstV: '12:13' } }), '12:13')
  // 数字列（右对齐 + 等宽）：首订 / 首日增量在 NUM_COL_RE 里
  const re = S.match(/const NUM_COL_RE = \/([^/]+)\//)
  assert.ok(re, '找不到 NUM_COL_RE')
  assert.ok(re[1].includes('shouding'), '首订要算数字列（右对齐）')
  assert.ok(!re[1].includes('firstDay'), '「上架」是时间戳，不是数字列')
  // 480 宽卡片：新列必须进中点串（列序靠后，不能只靠 slice(0,6)）
  assert.ok(S.includes('const CHIP_ALWAYS = { shouding: 1, firstDay: 1, firstV: 1 }'), '中点串要专门保住新补的三列')
})

test('设置 · 抓取范围：一站一行，「已选 x / y」+「⋯」菜单里放全选/不选/补齐缺失，默认折叠', () => {
  assert.ok(S.includes("h(PopMenu, { label: '⋯'"), '站点标题行右侧要有「⋯」菜单')
  assert.ok(S.includes("(open ? '▾ ' : '▸ ') + siteNameOf(s) + ' · 已选 ' + sel + ' / ' + total"), '标题行要显示「站点 · 已选 x / y」')
  for (const label of ["'全选这一站（' + total + '）'", "'全不选这一站'", "'补齐缺失（联网）'"]) {
    assert.ok(S.includes(label), '菜单里缺少：' + label)
  }
  assert.ok(S.includes('const siteOpen = function (s) { return closedGroups[s] === true }'), '站点默认折叠（没有记录 = 收起）')
  assert.ok(!/h\('button', \{ className: 'rs-btn is-ghost', onClick: function \(\) \{ setAll\(/.test(S), '全选/不选不许再平铺成按钮')
})

test('修假设置：起点榜条数输入框置灰，并说明「站点固定 20 条」', () => {
  assert.ok(S.includes("const qidianFixed = /^qidian\\./.test(String(curBoard || ''))"), '要按 boardId 判定起点固定条数')
  const i = S.indexOf("每榜取多少条")
  assert.ok(i > 0, '找不到本榜设置的输入行')
  const body = S.slice(i, i + 1100)
  assert.ok(body.includes('disabled: depthLocked || busy'), '条数输入框必须置灰')
  assert.ok(body.includes("'条 · ' + depthNote"), '置灰时要写清原因（不能只留一个灰框）')
  assert.ok(S.includes('站点固定 20 条（移动端单页 20 条，站点分页接口在反爬后）'), '要有「站点固定 20 条」提示')
  assert.ok(body.includes("disabled: depthLocked || busy"), '保存按钮同样置灰（改了也不生效）')
})

test('0.6 修正：三江那列是 Unix 秒时间戳 ⇒ 显示成 MM-DD HH:mm，绝不放裸数字', () => {
  const mod = load()
  const { cell, fmtStamp } = mod.__test.helpers
  assert.equal(typeof fmtStamp, 'function', 'fmtStamp 必须是纯函数')
  // 真实数据（2026-10-28 快照 qidiantu.sanjiang「大话华娱」）
  assert.equal(fmtStamp(1793000228), '10-26 15:37', '东八区 MM-DD HH:mm')
  assert.equal(fmtStamp(1793074419), '10-27 12:13')
  assert.equal(fmtStamp(null), '—')
  assert.equal(fmtStamp(0), '—', '0 不是时间戳 ⇒ 「—」')
  assert.equal(fmtStamp(999999999), '—', '小于 1e9 的整数不是时间戳 ⇒ 「—」')
  const shown = cell({ key: 'firstDay' }, { extra: { firstDay: 1793000228 } })
  assert.equal(shown, '10-26 15:37', '单元格不得直接显示裸时间戳')
  assert.ok(!/^\d{10}$/.test(String(shown)), '这一列不允许出现 10 位裸数字')
  // 断言口径：这一列渲染出来的任何值都不许是 >1e9 的裸数字
  for (const v of [1793000228, 1793008856, 1793074419]) {
    const out = Number(cell({ key: 'firstDay' }, { extra: { firstDay: v } }))
    assert.ok(!(isFinite(out) && out > 1e9), '渲染结果不得是 >1e9 的裸数字：' + out)
  }
  // 「上架」按文本走，不进数字右对齐那一组
  const re = S.match(/const NUM_COL_RE = \/([^/]+)\//)
  assert.ok(re && !re[1].includes('firstDay'), '时间戳列不参与数字右对齐')
})

test('0.6.1：详情卡不再显示「更新 …」（与列口径统一，同一个 lastChapterUpdateTime）', () => {
  assert.ok(!S.includes("'更新 ' + fmtTime(ex.lastChapterUpdateTime)"), '详情卡的「更新」行必须移除')
})

test('0.6 修正：「展开简介」只在真的被截断时出现（实测溢出 + resize 重量）', () => {
  const i = S.indexOf('function BoardDesc(props)')
  const body = S.slice(i, i + 1800)
  assert.ok(body.includes('scrollHeight - el.clientHeight > 1'), '要用实测溢出判断，不是按字数猜')
  assert.ok(body.includes("window.addEventListener('resize', measure)"), '窗口尺寸变化要重量')
  assert.ok(body.includes('const textRef = React.useRef(null)') && body.includes('ref: textRef'), '要量真实渲染后的盒子')
  assert.ok(body.includes('(over || open)'), '收起态溢出或有溢出时才给按钮；展开态保留「收起」')
  assert.ok(!body.includes('text.length > 60'), '旧的按字数阈值判断必须移除')
})

test('0.6.1：全站统一不出「最近更新 / 更新时间」列（刺猬猫、番茄都没有）', () => {
  // 客户端：没有 update / updated 的渲染分支，也没进中点串/摘要列
  assert.ok(!S.includes("if (k === 'update')"), '「最近更新」列的渲染分支必须删掉')
  assert.ok(!S.includes("if (k === 'updated') return fmtTime"), '榜单「更新时间」列的渲染分支必须删掉（0.6.0 之前就该死了）')
  // 注意：60-bookmarks.js 里的 k === 'updated' 是**书签排序键**（按 capturedAt），与榜单列无关，保留
  assert.ok(!S.includes("'更新 ' + fmtTime(ex.lastChapterUpdateTime)"), '详情卡也不显示「更新」')
  assert.ok(!/CHIP_ALWAYS = \{[^}]*update/.test(S), '中点串不许再带最近更新')
  assert.ok(!/CHIP_SKIP = \{[^}]*updated/.test(S), 'CHIP_SKIP 里的 updated 是死配置，一并清掉')
  assert.ok(!/SUMMARY_COLS = \{[^}]*updated/.test(S), 'SUMMARY_COLS 里的 updated 一并清掉')
  assert.ok(!/updated: 7/.test(S) && !S.includes("if (k === 'updated') return 124"), '列优先级/列宽里也不许再提 updated')
})

test('0.6.2：条数只对真读 depth 的榜开放；派生榜说「全部 N 条」并隐藏扫描入口', () => {
  // host：canDepth 按适配器是否真读 depth 判（起点/起点图/首订约/派生/菠萝包 = 不可调）
  assert.ok(HOST.includes('const depthLocked = (boardId: string) =>'), '缺少口径函数（host catalog）')
  // 口径：起点 / 起点图 / 刺猬猫首订约 / 番茄派生 / 菠萝包 = 不可调
  for (const frag of ["boardId.startsWith('qidian.')", "boardId.startsWith('qidiantu.')", "boardId === 'ciweimao.buy.latest'", "boardId.startsWith('fanqie.derived.')", "boardId.startsWith('sfacg.')"]) {
    assert.ok(HOST.includes(frag), 'canDepth 口径缺少：' + frag)
  }
  assert.ok(HOST.includes('canDepth: !depthLocked(boardId)'), 'catalog 必须用口径函数算 canDepth')
  // client：派生榜单独标、摘要换成「全部 N 条」
  assert.ok(S.includes('const derivedBoard = isDerived'), '派生榜复用 isDerived')
  assert.ok(S.includes("? '全部 ' + ((data && data.rows) ? data.rows.length : 0) + ' 条（本地派生榜不设条数）'"), '派生榜摘要要写「全部 N 条」')
  assert.ok(S.includes('const depthLocked = qidianFixed || derivedBoard || info.can === false'), '锁定条件要含派生榜与 canDepth:false')
  // 条数不可调时不再给「保存 / 保存并扫描」；扫描入口在操作条，派生榜连它都不给
  assert.ok(S.includes("depthLocked ? null : h('button', { className: 'rs-btn', disabled: busy, onClick: function () { saveDepth(false) }"), '锁定时不给「保存条数」')
  assert.ok(S.includes("isDerived ? null : h('button', {"), '派生榜不给「扫描本榜」（点了只会拿到警告）')
  // 输入框置灰 + 占位「全部」
  assert.ok(S.includes("placeholder: derivedBoard ? '全部' : String(fixedDepth != null ? fixedDepth : info.max)"), '派生榜输入框占位「全部」')
})
