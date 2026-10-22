/**
 * 面板「Spec 审查缺口」离线验收（2026-10-22）。
 *
 * 覆盖 docs/rank-scan/方案-简明性与易用性优化-v1.md 里被 Spec 审查点出的条目：
 *   S3 未到计划/待补跑 ≠ 失败 · S4 恢复默认只改草稿 · S5 问题带时间与逐项动作
 *   S6 变化按站分组、可点进榜、条数用真实总数 · S7 首订「本期上架作品」
 * 外加原报告次要项：粘性表头、补全缺数就近提示、设置站分组折叠、书签显示中文榜名、
 * 自动补全开关归到「数据与性能」。
 *
 * 全部离线：只读 client/client.js，在 vm 里加载 + 用带状态的迷你 React 渲染成虚拟树。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

/* ---------- 迷你 React：真的记账 state/refs/effects ---------- */
function React17() {
  const H = { cur: null }
  function Cmp(props) { this.props = props || {}; this.state = {} }
  Cmp.prototype.setState = function (patch) { this.state = { ...this.state, ...patch } }
  Cmp.prototype.isReactComponent = true
  Cmp.prototype.render = function () { return null }
  const api = {
    createElement: (type, props, ...children) => {
      const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
      // 真 React 把 children 放在 props.children 里（Section 这类分组组件就是这么用的）
      return { type, props: { ...(props || {}), children: kids }, children: kids }
    },
    useState: (init) => {
      const c = H.cur
      const i = c.idx++
      if (!(i in c.state)) c.state[i] = typeof init === 'function' ? init() : init
      return [c.state[i], (v) => { c.state[i] = typeof v === 'function' ? v(c.state[i]) : v }]
    },
    useRef: (v) => {
      const c = H.cur
      const i = c.idx++
      if (!(i in c.refs)) c.refs[i] = { current: v }
      return c.refs[i]
    },
    useEffect: (fn, deps) => {
      const c = H.cur
      const i = c.idx++
      c.effs[i] = { fn, deps }
    },
    useLayoutEffect: () => { H.cur.idx++ },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    Component: Cmp,
    Fragment: 'Fragment',
  }
  const sameDeps = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i])
  function mount(Comp, props) {
    const c = { state: {}, refs: {}, effs: {}, ran: {}, idx: 0 }
    const out = {
      render() {
        H.cur = c
        c.idx = 0
        const tree = expand(Comp(props || {}))
        H.cur = null
        return tree
      },
      runEffects() {
        H.cur = c
        Object.keys(c.effs).forEach((k) => {
          const e = c.effs[k]
          if (!e || typeof e.fn !== 'function') return
          if (c.ran[k] && e.deps && sameDeps(c.ran[k], e.deps)) return
          c.ran[k] = e.deps || null
          try { e.fn() } catch (err) { /* 组件 effect 失败不该让断言假崩 */ }
        })
        H.cur = null
      },
      async flush(rounds = 12) {
        for (let i = 0; i < rounds; i++) await Promise.resolve()
        out.render()
        out.runEffects()
        return out.render()
      },
      act(fn) {
        H.cur = c
        fn()
        H.cur = null
        out.render()
        out.runEffects()
        return out.render()
      },
      state() { return c.state },
    }
    out.render()
    out.runEffects()
    return out
  }
  return { api, mount }
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  return (node.children || []).map(textOf).join(' ')
}
function collect(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return out }
  if (node.type) out.push(node)
  ;(node.children || []).forEach((n) => collect(n, out))
  return out
}
function expand(node, depth = 0) {
  if (node === null || node === undefined || node === false || depth > 14) return node
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map((n) => expand(n, depth + 1))
  if (typeof node.type === 'function') {
    if (node.type.prototype && node.type.prototype.isReactComponent) {
      const inst = new node.type(node.props || {})
      return expand(inst.render(), depth + 1)
    }
    return expand(node.type(node.props || {}), depth + 1)
  }
  return { ...node, children: (node.children || []).map((n) => expand(n, depth + 1)) }
}
const nodesOf = (tree, pred) => collect(tree).filter(pred)
const byText = (tree, text, type) => nodesOf(tree, (n) => (!type || n.type === type) && textOf(n).trim() === text)[0]
function click(tree, text, type) {
  const n = byText(tree, text, type || 'button')
  assert.ok(n, '找不到可点的元素：' + text)
  n.props.onClick({ preventDefault() {}, stopPropagation() {}, target: {} })
}

/* ---------- 载入面板 bundle ---------- */
function load(routes = {}) {
  let registration = null
  const calls = []
  const fetchImpl = (url, init) => {
    const raw = String(url)
    calls.push({ url: raw, init })
    const key = raw.replace('/api/rank-scan', '')
    const body = Object.prototype.hasOwnProperty.call(routes, key) ? routes[key] : {}
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }
  const store = { _m: {} }
  const sandbox = {
    console, Promise, JSON, Math, Number, String, Object, Array, Date, RegExp, Error,
    fetch: fetchImpl,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    Event: function Event() {},
    localStorage: {
      _m: store._m,
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null },
      setItem(k, v) { this._m[k] = String(v) },
      removeItem(k) { delete this._m[k] },
    },
    sessionStorage: {
      _m: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null },
      setItem(k, v) { this._m[k] = String(v) },
      removeItem(k) { delete this._m[k] },
    },
    document: {
      visibilityState: 'visible',
      activeElement: null,
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll() { return [] },
      querySelector() { return null },
      createElement() { return {} },
    },
    __ModuleLoader__: { load: (r) => { registration = r } },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox, { filename: 'client/client.js' })
  const react = React17()
  const mod = registration.factory((name) => {
    if (name === 'react') return react.api
    throw new Error('unexpected require: ' + name)
  })
  return { mod, mount: react.mount, calls, sandbox }
}

/* ---------- 夹具 ---------- */
const BASE_OV = {
  dataDate: '2026-10-22',
  dates: ['2026-10-21', '2026-10-22'],
  baselineDate: '2026-10-21',
  revision: 'r1',
  hiddenCount: 0,
  storage: { totalBytes: 1000, stateBytes: 100, snapshotBytes: 900, dates: 2, oldest: '2026-09-01', newest: '2026-10-22', retentionDays: 180, bookmarks: 0, cachedAt: '2026-10-22T05:31:00Z' },
  services: { webServer: true, timerService: true, timerArmed: true, schedule: { now: '06:00', today: '2026-10-22', waiting: [], due: [], fallback: [], staleFlag: {} } },
  scan: { outcome: 'completed', attempt: 1, trigger: 'timer', progress: { done: 1, total: 1 }, warnings: [] },
}

function ovWith(boards, over = {}) {
  const ok = boards.filter((b) => b.status === 'ok').length
  return {
    ...BASE_OV,
    ...over,
    counts: { ok, missing: boards.length - ok, stale: 0, login_required: 0, truncated: 0 },
    sites: [{ site: 'qidian', siteName: '起点', boards }],
  }
}
/** scheduleState 刻意**不预置**：没有该字段才该走 timer-plan 兜底（后端给 null 才表示「已试过」） */
const board = (id, name, status, extra = {}) => ({
  boardId: id, name, status, up: null, newCount: null, out: null,
  lastCapture: null, note: null, derived: false, displayed: true,
  plannedTime: '01:30', ...extra,
})

/** Section 默认展开第一组、其余收起：断言子项前先把它点开（等价于使用者的操作） */
function openSection(tree, title) {
  const btn = nodesOf(tree, (n) => n.type === 'button' && textOf(n).indexOf(title) >= 0)[0]
  assert.ok(btn, '找不到设置分组：' + title)
  if (textOf(btn).trim().indexOf('▸') === 0) {
    btn.props.onClick({ preventDefault() {}, stopPropagation() {}, target: {} })
    return true
  }
  return false
}

function overviewMount(mod, mount, ov, extraProps = {}) {
  return mount(mod.__test.components.Overview, {
    ov, busy: false, act() {}, reload() {}, narrow: false, rev: 'r1',
    onOpenBoard() {}, onRescanBoard() {}, ...extraProps,
  })
}

/* ---------- S3 未到计划 / 待补跑 ---------- */
test('S3 未到计划的榜不算失败：不出现「待处理」与「重试失败」', async () => {
  const { mod, mount } = load({ '/changes': { count: 0, sites: [] }, '/enrich-status': { pending: 0 } })
  const ov = ovWith([
    board('qidian.sign.cat12', '轻小说', 'ok', { up: 1, newCount: 0, out: 0 }),
    board('qidian.sign.cat4', '玄幻', 'missing', { scheduleState: 'waiting', plannedTime: '08:30' }),
  ])
  const app = overviewMount(mod, mount, ov)
  const tree = await app.flush()
  const text = textOf(tree)
  assert.match(text, /未到计划 1/, '未到计划要单独报数，别混进失败')
  assert.doesNotMatch(text, /重试失败/, '还没到点的榜不该出现「重试失败」按钮')
  assert.doesNotMatch(text, /需要处理/, '没有问题时不渲染「需要处理」块')
})

test('S3 待补跑的榜单独标出，但仍不算失败与重试对象', async () => {
  const { mod, mount } = load({ '/changes': { count: 0, sites: [] }, '/enrich-status': { pending: 0 } })
  const ov = ovWith([board('qidian.sign.cat4', '玄幻', 'missing', { scheduleState: 'due', plannedTime: '01:30' })])
  const tree = await overviewMount(mod, mount, ov).flush()
  const text = textOf(tree)
  assert.match(text, /待补跑 1/)
  assert.doesNotMatch(text, /重试失败/)
  assert.doesNotMatch(text, /需要处理/)
})

test('S3 没给 scheduleState 时退回 timer-plan 的站级 waiting（旧宿主也不误报）', async () => {
  const { mod, mount } = load({ '/changes': { count: 0, sites: [] }, '/enrich-status': { pending: 0 } })
  const ov = ovWith(
    [board('fanqie.m.new.262', '都市脑洞', 'missing')],
    { services: { ...BASE_OV.services, schedule: { now: '06:00', today: '2026-10-22', waiting: ['fanqie'], due: [], fallback: [], staleFlag: {} } } },
  )
  const tree = await overviewMount(mod, mount, ov).flush()
  assert.match(textOf(tree), /未到计划 1/)
  assert.doesNotMatch(textOf(tree), /重试失败/)
})

test('S3 真失败（无计划态）才算待处理，并给出重试入口', async () => {
  const { mod, mount } = load({ '/changes': { count: 0, sites: [] }, '/enrich-status': { pending: 0 } })
  const ov = ovWith([board('qidian.sign.cat4', '玄幻', 'missing', { note: 'fetch failed', lastCapture: '2026-10-22T01:30:00Z' })])
  const tree = await overviewMount(mod, mount, ov).flush()
  const text = textOf(tree)
  assert.match(text, /需要处理/)
  assert.match(text, /重试失败 1 个榜/)
})

/* ---------- S5 问题带时间与逐项动作 ---------- */
test('S5 每条问题带发生时间，并可「查看本榜 / 重扫本榜」', async () => {
  const opened = []
  const rescanned = []
  const { mod, mount } = load({ '/changes': { count: 0, sites: [] }, '/enrich-status': { pending: 0 } })
  const ov = ovWith([
    board('qidiantu.shouding', '首订榜', 'stale', {
      attempt: { status: 'stale', reason: '疑似未刷新', at: '2026-10-22T04:40:00Z', by: 'timer', rows: 0 },
      lastCapture: '2026-10-22T04:40:00Z',
    }),
  ])
  const app = overviewMount(mod, mount, ov, {
    onOpenBoard: (id) => opened.push(id),
    onRescanBoard: (id) => rescanned.push(id),
  })
  let tree = await app.flush()
  const issues = nodesOf(tree, (n) => n.type === 'div' && /首订榜/.test(textOf(n)) && /数据待核对|整榜一致|不可信/.test(textOf(n)))
  assert.ok(issues.length, '问题行要出现')
  // 时间来自 attempt.at（04:40 是本地 +08 口径的 12:40，或 UTC 直接渲染；两种都算「有显示时间」）
  assert.match(textOf(tree), /\d{1,2}:\d{2}/, '问题要带发生时间')
  click(tree, '查看本榜')
  click(tree, '重扫本榜')
  assert.deepEqual(opened, ['qidiantu.shouding'])
  assert.deepEqual(rescanned, ['qidiantu.shouding'])
})

/* ---------- S6 变化：真实总数 + 按站分组 + 可点进榜 ---------- */
const CHANGES = {
  date: '2026-10-22',
  baselineDate: '2026-10-21',
  count: 115,
  revision: 'r1',
  excluded: [],
  noBaseline: [],
  sites: [
    {
      site: 'qidiantu', siteName: '起点图',
      groups: [{
        group: '新入榜', count: 113,
        items: [
          { boardId: 'qidiantu.shouding', boardName: '首订榜', baselineDate: '2026-10-21', group: '新入榜', title: '书甲', delta: '第1', days: 1 },
          { boardId: 'qidiantu.shouding', boardName: '首订榜', baselineDate: '2026-10-21', group: '新入榜', title: '书乙', delta: '第2', days: 1 },
        ],
      }],
    },
    {
      site: 'qidian', siteName: '起点',
      groups: [{ group: '上升', count: 2, items: [{ boardId: 'qidian.sign.cat12', boardName: '轻小说', baselineDate: '2026-10-21', group: '上升', title: '书丙', delta: '↑3', days: 4 }] }],
    },
  ],
}

test('S6 变化条数用真实总数（预览只有 20 条也要说 113 条）', async () => {
  const { mod, mount } = load({ '/changes': CHANGES, '/enrich-status': { pending: 0 } })
  const tree = await overviewMount(mod, mount, ovWith([board('qidian.sign.cat12', '轻小说', 'ok')])).flush()
  const text = textOf(tree)
  assert.match(text, /今天的变化（115 条）/, '标题要用后端真实总数')
  assert.match(text, /新入榜 113/, '分组按钮也要用真实总数，不能是预览条数 2')
  assert.match(text, /最多列 20 条/, '预览被截断时必须说明')
})

test('S6 变化按站分组，且点行能在榜单页打开该榜（保上下文）', async () => {
  const opened = []
  const { mod, mount } = load({ '/changes': CHANGES, '/enrich-status': { pending: 0 } })
  const tree = await overviewMount(mod, mount, ovWith([board('qidian.sign.cat12', '轻小说', 'ok')]), {
    onOpenBoard: (id) => opened.push(id),
  }).flush()
  const text = textOf(tree)
  assert.match(text, /起点图 · 2 条/, '同站的变化要成组出现')
  assert.match(text, /起点 · 1 条/)
  const row = nodesOf(tree, (n) => n.type === 'tr' && /书丙/.test(textOf(n)))[0]
  assert.ok(row, '变化行要在表里')
  row.props.onClick({ preventDefault() {}, stopPropagation() {}, target: {} })
  assert.deepEqual(opened, ['qidian.sign.cat12'])
})

test('S7 首订榜的「新入榜」在面板上叫「本批上架」', async () => {
  const { mod, mount } = load({ '/changes': CHANGES, '/enrich-status': { pending: 0 } })
  const tree = await overviewMount(mod, mount, ovWith([board('qidian.sign.cat12', '轻小说', 'ok')])).flush()
  const text = textOf(tree)
  assert.match(text, /本批上架/, '首订换批不是榜单竞争意义的新入榜')
})

/* ---------- S4 设置：恢复默认只改草稿 ---------- */
const CATALOG = {
  boards: [
    { boardId: 'qidian.sign.cat12', site: 'qidian', siteName: '起点', group: '签约榜', label: '轻小说' },
    { boardId: 'qidian.sign.cat4', site: 'qidian', siteName: '起点', group: '签约榜', label: '玄幻' },
    { boardId: 'fanqie.m.new.262', site: 'fanqie', siteName: '番茄', group: '男频新书榜', label: '都市脑洞' },
  ],
  captures: ['qidian.sign.cat4'],
  displays: ['qidian.sign.cat4'],
  defaultCaptures: ['qidian.sign.cat12', 'qidian.sign.cat4'],
  defaultDisplays: ['qidian.sign.cat12', 'qidian.sign.cat4'],
  depths: {},
  autoEnrich: true,
  qidian: { enrich: false },
  requestIntervalMs: 1000,
  timer: { enabled: true, siteTimes: { qidian: '01:30' }, fallbackTime: '22:30' },
}

test('S4 恢复默认只改草稿并报「新增/移除」数，不直接落盘', async () => {
  const { mod, mount, calls } = load({
    '/catalog': CATALOG,
    '/timer-plan': { ok: true, plan: { now: '06:00', today: '2026-10-22', enabled: true, waiting: [], due: [], fallback: [] } },
    '/overview': BASE_OV,
  })
  const app = mount(mod.__test.components.SettingsTab, { ov: BASE_OV, onSaved() {} })
  let tree = await app.flush()
  tree = app.act(() => openSection(tree, '抓取范围'))
  click(tree, '恢复默认')
  tree = app.render()
  const text = textOf(tree)
  assert.match(text, /将新增 1 个、移除 0 个/, '要说清这次恢复改了什么')
  assert.match(text, /有未保存的改动/, '恢复默认只是草稿')
  assert.ok(
    !calls.some((c) => String(c.url).indexOf('/select') >= 0),
    '点「恢复默认」不许直接写盘（必须再点保存设置）',
  )
})

test('S4 宿主没给默认集时明确拒绝，不自造一套默认', async () => {
  const noDef = { ...CATALOG }
  delete noDef.defaultCaptures
  const { mod, mount } = load({
    '/catalog': noDef,
    '/timer-plan': { ok: true, plan: { now: '06:00', today: '2026-10-22', enabled: true, waiting: [], due: [], fallback: [] } },
    '/overview': BASE_OV,
  })
  const app = mount(mod.__test.components.SettingsTab, { ov: BASE_OV, onSaved() {} })
  let tree = await app.flush()
  tree = app.act(() => openSection(tree, '抓取范围'))
  click(tree, '恢复默认')
  tree = app.render()
  assert.match(textOf(tree), /没有提供默认抓取集/)
})

test('S4 设置里的站分组可折叠', async () => {
  const { mod, mount } = load({
    '/catalog': CATALOG,
    '/timer-plan': { ok: true, plan: { now: '06:00', today: '2026-10-22', enabled: true, waiting: [], due: [], fallback: [] } },
    '/overview': BASE_OV,
  })
  const app = mount(mod.__test.components.SettingsTab, { ov: BASE_OV, onSaved() {} })
  let tree = await app.flush()
  tree = app.act(() => openSection(tree, '抓取范围'))
  const groupHead = nodesOf(tree, (n) => n.type === 'div' && textOf(n).trim() === '▾ 起点 · 签约榜（2）')[0]
  assert.ok(groupHead, '组标题要能点')
  tree = app.act(() => groupHead.props.onClick({ preventDefault() {}, stopPropagation() {}, target: {} }))
  assert.match(textOf(tree), /▸ 起点 · 签约榜（2）/, '点过之后收起')
})

test('自动补全开关在「数据与性能」组，不再挤在抓取范围里', async () => {
  const { mod, mount } = load({
    '/catalog': CATALOG,
    '/timer-plan': { ok: true, plan: { now: '06:00', today: '2026-10-22', enabled: true, waiting: [], due: [], fallback: [] } },
    '/overview': BASE_OV,
  })
  const app = mount(mod.__test.components.SettingsTab, { ov: BASE_OV, onSaved() {} })
  let tree = await app.flush()
  tree = app.act(() => { openSection(tree, '抓取范围'); openSection(tree, '数据与性能') })
  // 取**最内层**的分组块：外层包装 div 的文本也会以「▾ 抓取范围」开头，会把别的组一起算进来
  const rangeSec = nodesOf(tree, (n) => n.type === 'div' && /抓取范围/.test(textOf(n)) && !/数据与性能/.test(textOf(n)))[0]
  assert.ok(rangeSec, '要有抓取范围组')
  assert.doesNotMatch(textOf(rangeSec), /扫描后自动补全缺失字段/, '抓取范围不该再管补全开关')
  const dataSec = nodesOf(tree, (n) => n.type === 'div' && /数据与性能/.test(textOf(n)) && !/抓取范围/.test(textOf(n)))[0]
  assert.ok(dataSec, '要有数据与性能组')
  assert.match(textOf(dataSec), /扫描后自动补全缺失字段/, '补全开关属于数据与性能')
})

/* ---------- 次要项 ---------- */
test('粘性表头：榜单表头 sticky，长列表滚动时列名不消失', async () => {
  const { mod, mount } = load({
    '/overview': ovWith([board('qidian.sign.cat12', '轻小说', 'ok')]),
    '/changes': { count: 0, sites: [] },
    '/enrich-status': { pending: 0 },
  })
  const tree = await overviewMount(mod, mount, ovWith([board('qidian.sign.cat12', '轻小说', 'ok')])).flush()
  const th = nodesOf(tree, (n) => n.type === 'th')[0]
  assert.ok(th, '要有表头')
  assert.equal(th.props.style.position, 'sticky')
  assert.equal(th.props.style.top, 0)
})

test('书签详情用中文榜名，不再直接显示 boardId', () => {
  const { mod } = load()
  const { boardLabel, rememberBoardNames } = mod.__test.helpers
  rememberBoardNames([{ boardId: 'qidiantu.shouding', name: '首订榜', siteName: '起点图' }])
  assert.equal(boardLabel('qidiantu.shouding'), '起点图 · 首订榜')
  assert.equal(boardLabel('unknown.board'), 'unknown.board', '认不出来的榜名允许退回 id，但不许报错')
})
