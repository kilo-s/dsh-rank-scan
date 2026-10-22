/**
 * 面板「简明性 / 易用性」（工作包 B·C·D）离线验收。
 * 全部断言都不联网、不写运行目录：只读 client/client.js，在 vm 里加载并渲染成虚拟树。
 * 口径：docs/rank-scan/方案-简明性与易用性优化-v1.md（推荐项已确认）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, '..', 'client', 'client.js')
const SRC = readFileSync(SOURCE, 'utf8')

function fakeReact() {
  function Component(props) { this.props = props || {} }
  Component.prototype.setState = function () {}
  return {
    createElement: (type, props, ...children) => {
      const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
      const p = { ...(props || {}) }
      if (kids.length) p.children = kids.length === 1 ? kids[0] : kids
      return { type, props: p, children: kids }
    },
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: (v) => ({ current: v }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    Component,
    Fragment: 'Fragment',
  }
}
function load(opts = {}) {
  let registration = null
  const calls = []
  const routes = opts.routes || {}
  const fetchImpl = (url) => {
    const raw = String(url)
    calls.push(raw)
    const key = raw.replace('/api/rank-scan', '')
    const body = Object.prototype.hasOwnProperty.call(routes, key) ? routes[key] : {}
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }
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
  if (opts.shared) sandbox.__rankScanShared = opts.shared
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox, { filename: 'client/client.js' })
  const React = fakeReact()
  const mod = registration.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require: ' + name) })
  return { mod, sandbox, calls }
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

/** 把函数组件真的跑一遍（假 React 不会自己渲染子组件），便于断言渲染结果 */
function expand(node, depth = 0) {
  if (node === null || node === undefined || node === false || depth > 12) return node
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map((n) => expand(n, depth + 1))
  if (typeof node.type === 'function') {
    // 类组件要 new 出来再 render（TabBoundary 就是类组件）
    if (node.type.prototype && node.type.prototype.isReactComponent) {
      const inst = new node.type(node.props || {})
      return expand(inst.render(), depth + 1)
    }
    return expand(node.type(node.props || {}), depth + 1)
  }
  return { ...node, children: (node.children || []).map((n) => expand(n, depth + 1)) }
}
function ovFixture(over) {
  return {
    dataDate: '2026-10-22',
    dates: ['2026-10-21', '2026-10-22'],
    baselineDate: '2026-10-21',
    counts: { ok: 1, missing: 1, stale: 0, login_required: 0, truncated: 0 },
    hiddenCount: 0,
    sites: [{
      site: 'qidian', siteName: '起点',
      boards: [
        { boardId: 'qidian.sign.cat12', name: '轻小说', status: 'ok', up: 2, newCount: 1, out: 0, lastCapture: '2026-10-22T05:30:00Z', note: null, derived: false, displayed: true },
        { boardId: 'qidian.sign.cat4', name: '玄幻', status: 'missing', up: null, newCount: null, out: null, lastCapture: null, note: '抓取失败', derived: false, displayed: true },
      ],
    }],
    storage: { totalBytes: 1000, stateBytes: 100, snapshotBytes: 900, dates: 2, oldest: '2026-10-21', newest: '2026-10-22', retentionDays: 180, bookmarks: 3, cachedAt: '2026-10-22T05:31:00Z' },
    services: { webServer: true, timerService: true, timerArmed: true, schedule: { now: '15:00', today: '2026-10-22', staleFlag: {} } },
    scan: { outcome: 'completed', attempt: 1, trigger: 'timer', progress: { done: 2, total: 2 }, warnings: [] },
    ...over,
  }
}

test('面板 bundle 仍能被加载并注册（改结构不许留语法/求值错）', () => {
  const { mod } = load()
  assert.equal(mod.name, 'dsh-rank-scan')
  assert.equal(typeof mod.apply, 'function')
  assert.equal(typeof mod.__test.helpers.revOf, 'function')
})

test('★ 同日重扫：修订号必须变（否则「今天的变化」永远停在扫描前）', () => {
  const { revOf } = load().mod.__test.helpers
  const a = ovFixture()
  const b = ovFixture({ storage: { ...a.storage, cachedAt: '2026-10-22T06:31:00Z' } })
  const c = ovFixture({ scan: { outcome: 'completed', attempt: 2, trigger: 'manual', progress: { done: 2, total: 2 }, warnings: [] } })
  assert.equal(revOf(a), revOf(ovFixture()), '同一份数据要稳定（不能每次渲染都变）')
  assert.notEqual(revOf(a), revOf(b), '存储缓存时间变了 ⇒ 说明又跑过一轮')
  assert.notEqual(revOf(a), revOf(c), '扫描记录变了 ⇒ 修订号必须变')
  assert.equal(revOf({ ...a, revision: 'r7' }), 'r7', '宿主给了 revision 就优先用它')
  assert.equal(revOf(null), '')
})

test('状态用文字说，不把内部五态直接漏到界面', () => {
  const { statusText, scanLabel } = load().mod.__test.helpers
  assert.equal(statusText('ok'), '已采集')
  assert.equal(statusText('missing'), '没抓到')
  assert.equal(statusText('stale'), '数据待核对')
  assert.equal(statusText('login_required'), '需要登录')
  assert.equal(statusText('truncated'), '没抓完')
  assert.match(scanLabel({ trigger: 'timer', outcome: 'completed' }), /定时.*已完成/)
  assert.match(scanLabel({ trigger: 'manual', outcome: 'cancelled' }), /手动.*已取消/)
})

test('★ 能力驱动：只有能核对内容日期的榜才有「按日回看」入口', () => {
  const { canDayQuery } = load().mod.__test.helpers
  assert.equal(canDayQuery('qidiantu.shouding'), true)
  assert.equal(canDayQuery('qidiantu.sanjiang'), false, '三江不支持按日回看，不许给注定失败的入口')
  assert.equal(canDayQuery('fanqie.m.new.262'), false)
  assert.equal(canDayQuery(undefined), false)
})

test('窄面板收起次级列，但不收主指标/变化/书名', () => {
  const { narrowColumns } = load().mod.__test.helpers
  const cols = [{ key: 'rank' }, { key: 'delta' }, { key: 'title' }, { key: 'author' }, { key: 'cat' }, { key: 'words' }, { key: 'days' }]
  assert.equal(narrowColumns(cols, false).length, 7, '宽面板一列都不许少')
  const narrow = narrowColumns(cols, true).map((c) => c.key)
  assert.deepEqual(narrow, ['rank', 'delta', 'title'])
  assert.deepEqual(narrowColumns([], true), [])
})

test('★ 概览：问题在前、变化在后；没问题时不渲染空异常块', () => {
  const { mod } = load()
  const Overview = mod.__test.components.Overview
  const withIssue = textOf(expand(Overview({ ov: ovFixture(), busy: false, act() {}, reload() {}, narrow: false, rev: 'r1' })))
  assert.match(withIssue, /需要处理/, '有缺失榜时必须出现「需要处理」')
  assert.match(withIssue, /扫描已选榜/)
  assert.match(withIssue, /重新载入/)
  assert.match(withIssue, /今天的变化/)
  assert.ok(withIssue.indexOf('需要处理') < withIssue.indexOf('今天的变化'), '问题块要在变化之前')
  const clean = ovFixture({ counts: { ok: 2, missing: 0, stale: 0, login_required: 0, truncated: 0 }, sites: [{ site: 'qidian', siteName: '起点', boards: [ovFixture().sites[0].boards[0]] }] })
  const okText = textOf(expand(Overview({ ov: clean, busy: false, act() {}, reload() {}, narrow: false, rev: 'r1' })))
  assert.ok(!/需要处理/.test(okText), '没有问题时不许留空异常框')
  assert.match(okText, /无待处理/)
})

test('概览不再承担存储/保留（移到设置），全部榜单可折叠', () => {
  const { mod } = load()
  const Overview = mod.__test.components.Overview
  const el = expand(Overview({ ov: ovFixture(), busy: false, act() {}, reload() {}, narrow: false, rev: 'r1' }))
  const txt = textOf(el)
  assert.ok(!/保留 \d+ 天/.test(txt), '保留天数不许再占概览')
  assert.match(txt, /全部榜单（2）/)
  const toggle = collect(el).filter((n) => n.type === 'button' && /全部榜单/.test(textOf(n)))
  assert.equal(toggle.length, 1)
  assert.equal(toggle[0].props['aria-expanded'], 'true', '默认展开，功能不许被藏掉')
})

test('★ 书签：默认紧凑卡（不铺开编辑框），编辑与删除收进「更多」', () => {
  const shared = {
    bookmarks: {
      list: { bookmarks: [{ bookKey: 'qidian:1', label: '测试书', author: '某人', site: 'qidian', collect: 12345, collectFrom: 'qidian-book-cache', collectLabel: '收藏', capturedAt: '2026-10-20', ageDays: 9, note: '#追更 好看', folders: ['追更'], tags: ['追更'], url: 'https://example.invalid/1', source: 'rank' }], folders: ['追更'] },
      filters: { q: '', site: '', folder: '', tag: '' },
      subs: new Set(), map: {}, total: 1,
    },
  }
  const { mod } = load({ shared })
  const el = expand(mod.__test.components.BookmarksTab({ openLink: () => {} }))
  const txt = textOf(el)
  assert.match(txt, /测试书/)
  assert.match(txt, /截止 10-20/)
  assert.match(txt, /数据已 9 天未更新/)
  assert.match(txt, /#追更 好看/, '备注默认以摘要形式出现')
  const nodes = collect(el)
  assert.equal(nodes.filter((n) => n.type === 'textarea').length, 0, '默认不许铺开备注编辑框')
  assert.ok(nodes.some((n) => n.type === 'button' && /更多/.test(textOf(n))), '低频操作收进更多')
  assert.ok(nodes.some((n) => n.type === 'a' && textOf(n) === '打开'))
  const region = SRC.slice(SRC.indexOf('function BookmarksTab'), SRC.indexOf('function BoardTab'))
  assert.ok(region.indexOf("target: '_blank'") < 0, '书签卡的打开必须走侧栏浏览器，不许裸新标签')
  assert.match(region, /保存失败：' \+ e \+ '　（草稿还在/, '保存失败要留草稿并说清楚')
})

test('★ 书签导出：范围与条数写清楚，未选不许静默等于全部', () => {
  assert.match(SRC, /'已选 ' \+ sel\.length \+ ' 条'/)
  assert.match(SRC, /'当前筛选 ' \+ list\.length \+ ' 条'/)
  assert.match(SRC, /'全部 ' \+ \(store\.total \|\| list\.length\) \+ ' 条'/)
  assert.match(SRC, /bookKeys: keys/, '导出必须传显式书号清单')
  assert.ok(SRC.indexOf('bookKeys: []') < 0, '空数组=全部 这种隐式语义不许再出现')
  assert.match(SRC, /这个范围没有可导出的条目/)
})

test('★ 设置：四组齐全 + 未保存提示 + 开关即时生效且失败回退', () => {
  for (const title of ['抓取范围', '扫描计划', '数据与性能', '关于与诊断']) {
    assert.ok(SRC.indexOf("'" + title + "（") >= 0 || SRC.indexOf(title) >= 0, '缺设置分组：' + title)
  }
  assert.match(SRC, /放弃改动/)
  assert.match(SRC, /有未保存的改动/)
  assert.match(SRC, /已恢复原状态/, '即时开关失败必须回退并说明')
  assert.match(SRC, /保存计划/)
  assert.match(SRC, /补齐该站缺失字段/, '全站补全挪到设置，但能力不许丢')
})

test('★ 榜单：条数「保存」与「保存并扫描本榜」分开；历史入口按能力出现', () => {
  assert.match(SRC, /'扫描本榜（联网）'/)
  assert.match(SRC, /'保存'/)
  assert.match(SRC, /'保存并扫描本榜'/)
  assert.match(SRC, /if \(canDayQuery\(curBoard\)\)/, '历史块必须按榜能力分支')
  assert.match(SRC, /条数已保存，但扫描失败/, '保存成功/采集失败要分开回执')
  assert.match(SRC, /正在查看历史：/, '看历史必须显式标出')
  assert.match(SRC, /无可比基准/, '没有基准不许报 0')
  assert.match(SRC, /新期：变化不可比/)
})

test('面板：四页签短名 + 最大化 + Esc 分层关闭', () => {
  for (const label of ["'概览'", "'榜单'", "'书签'", "'设置'"]) assert.ok(SRC.indexOf(label) >= 0, '缺页签：' + label)
  assert.match(SRC, /最大化/)
  assert.match(SRC, /还原/)
  assert.match(SRC, /useEscLayer/, 'Esc 要按层关：菜单 → 详情 → 面板')
  assert.match(SRC, /isEditableTarget/, '编辑中不许被 Esc 关掉面板')
  assert.match(SRC, /narrow: narrow/, '窄面板要能把宽度传下去')
  assert.match(SRC, /rev: rev/, '修订号要传给概览与榜单')
})

test('渲染冒烟：榜单/设置/面板 在虚拟树下不抛错', () => {
  const { mod } = load({ routes: { '/catalog': { boards: [], captures: [], displays: [], depths: {}, timer: { enabled: true, siteTimes: {}, fallbackTime: '22:30' }, qidian: {}, bookCache: { stat: {}, ttlDays: 7 } } } })
  const c = mod.__test.components
  assert.doesNotThrow(() => c.BoardTab({ ov: ovFixture(), openLink: () => {}, narrow: true, rev: 'r1' }))
  assert.doesNotThrow(() => c.SettingsTab({ ov: ovFixture(), onSaved() {} }))
  assert.doesNotThrow(() => c.PopMenu({ label: '更多', items: [{ label: 'x' }, { sep: true }, null] }))
})
/* ────────────────────────────────────────────────────────────────
 * 真实交互（带状态的迷你 React）：验证「保存失败留草稿 / 即时开关回退 /
 * 离开保护 / 上架日→数据日期映射」这些**状态机**行为，而不是只看源码字符串。
 * ──────────────────────────────────────────────────────────────── */
function makeHarness() {
  const H = { cur: null }
  function Cmp(props) { this.props = props || {} }
  Cmp.prototype.setState = function () {}
  Cmp.prototype.isReactComponent = {}
  const React = {
    createElement: (type, props, ...children) => {
      const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
      const p = { ...(props || {}) }
      if (kids.length) p.children = kids.length === 1 ? kids[0] : kids
      return { type, props: p, children: kids }
    },
    useState: (init) => {
      const c = H.cur
      const i = c.idx++
      if (!(i in c.state)) c.state[i] = typeof init === 'function' ? init() : init
      return [c.state[i], (v) => { c.state[i] = typeof v === 'function' ? v(c.state[i]) : v; c.dirty = true }]
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
  function sameDeps(a, b) {
    if (!a || !b || a.length !== b.length) return false
    return a.every((x, i) => x === b[i])
  }
  function mount(Comp, props) {
    const c = { state: {}, refs: {}, effs: {}, ran: {}, idx: 0, dirty: false }
    const api = {
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
          try { e.fn() } catch (err) { /* 组件里的 effect 失败不该让测试假崩 */ }
        })
        H.cur = null
      },
      async flush(rounds = 10) {
        for (let i = 0; i < rounds; i++) await Promise.resolve()
        api.render()
        api.runEffects()
        return api.render()
      },
      act(fn) {
        H.cur = c
        c.dirty = false
        fn()
        H.cur = null
        api.render()
        api.runEffects()
        return api.render()
      },
      state() { return c.state },
    }
    api.render()
    api.runEffects()
    return api
  }
  return { React, mount }
}

function nodesOf(tree, pred) {
  return collect(tree).filter(pred)
}
function byText(tree, text, type) {
  return nodesOf(tree, (n) => (!type || n.type === type) && textOf(n).trim() === text)[0]
}
function click(tree, text, type) {
  const n = byText(tree, text, type || 'button')
  assert.ok(n, '找不到可点的元素：' + text)
  n.props.onClick({ preventDefault() {}, stopPropagation() {}, target: {} })
}

function loadInteractive(opts = {}) {
  const h = makeHarness()
  let registration = null
  const calls = []
  const routes = opts.routes || {}
  const fetchImpl = (url, init) => {
    const raw = String(url)
    calls.push({ url: raw, body: init && init.body ? JSON.parse(String(init.body)) : null })
    const key = raw.replace('/api/rank-scan', '')
    const body = Object.prototype.hasOwnProperty.call(routes, key) ? routes[key] : {}
    if (body && body.__reject) return Promise.reject(new Error(body.__reject))
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }
  const sandbox = {
    console, Promise, JSON, Math, Number, String, Object, Array, Date, RegExp, Error,
    fetch: fetchImpl,
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    Event: function Event() {},
    dispatchEvent: () => true,
    addEventListener: () => {}, removeEventListener: () => {},
    localStorage: {
      _m: { 'rank-scan-panel:open:v1': '1' },
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null },
      setItem(k, v) { this._m[k] = String(v) },
      removeItem(k) { delete this._m[k] },
    },
    document: {
      visibilityState: 'visible',
      activeElement: null,
      addEventListener() {}, removeEventListener() {},
      querySelectorAll() { return [] }, querySelector() { return null },
      createElement() { return {} },
    },
    __ModuleLoader__: { load: (r) => { registration = r } },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  if (opts.shared) sandbox.__rankScanShared = opts.shared
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox, { filename: 'client/client.js' })
  const mod = registration.factory((name) => {
    if (name === 'react') return h.React
    throw new Error('unexpected require: ' + name)
  })
  return { mod, mount: h.mount, calls, sandbox }
}

const CATALOG = {
  boards: [{ boardId: 'qidiantu.shouding', site: 'qidiantu', siteName: '起点图', group: '首订/三江', label: '首订榜', captured: true, displayed: true, depth: 20, maxDepth: 100, canDepth: true, depthHint: '' }],
  captures: ['qidiantu.shouding'], displays: ['qidiantu.shouding'], depths: { 'qidiantu.shouding': 20 },
  autoEnrich: true,
  qidian: { enrich: false, cache: { books: 3 }, ttlDays: 7 },
  requestIntervalMs: 1000,
  bookCache: { stat: { entries: 2 }, ttlDays: 7 },
  timer: { enabled: true, siteTimes: { qidian: '01:30' }, fallbackTime: '22:30', siteLastScan: {}, wired: true },
}

test('★ 上架日 X ⇒ 请求数据日期 X+1（首订 n-1 锚），保存后日期切到数据日', async () => {
  const { mod, mount, calls } = loadInteractive({
    routes: {
      '/catalog': CATALOG,
      '/board': { boardId: 'qidiantu.shouding', columns: [{ key: 'rank', label: '名次' }, { key: 'title', label: '书名' }], rows: [], dates: [], sortOptions: [{ value: '', label: '默认' }], dataDate: '2026-10-22', baselineDate: '2026-10-21' },
      '/day': { ok: true, date: '2026-10-23', contentDate: '2026-10-22', note: '已存入 2026-10-23 快照' },
    },
  })
  const ovQd = ovFixture({ sites: [{ site: 'qidiantu', siteName: '起点图', boards: [{ boardId: 'qidiantu.shouding', name: '首订榜', status: 'ok', up: 1, newCount: 0, out: 0, lastCapture: '2026-10-22T05:30:00Z', note: null, derived: false, displayed: true }] }] })
  const app = mount(mod.__test.components.BoardTab, { ov: ovQd, openLink() {}, narrow: false, rev: 'r1' })
  let tree = await app.flush()
  click(tree, '更多 ▾')
  tree = app.render()
  const dateInput = nodesOf(tree, (n) => n.type === 'input' && n.props.type === 'date')[0]
  assert.ok(dateInput, '首订榜必须能按上架日回看（能力驱动入口在「更多」里）')
  tree = app.act(() => dateInput.props.onChange({ target: { value: '2026-10-22' } }))
  click(tree, '存入本地')
  await app.flush()
  const dayCall = calls.filter((c) => c.url.indexOf('/day') >= 0).pop()
  assert.ok(dayCall, '没有发出 /day 请求')
  assert.equal(dayCall.body.date, '2026-10-23', '上架日 2026-10-22 必须请求数据日期 2026-10-23（contentDateFor = 数据日-1）')
  assert.equal(dayCall.body.save, true)
  const after = app.render()
  assert.match(textOf(after), /正在查看历史：2026-10-23/, '保存后日期应切到**数据日** 2026-10-23')
})

test('★ 书签保存失败：草稿留着、错误就地显示（不是静默丢）', async () => {
  const shared = {
    bookmarks: {
      list: { bookmarks: [{ bookKey: 'qidian:1', label: '测试书', author: '某人', site: 'qidian', collect: 100, collectLabel: '收藏', capturedAt: '2026-10-21', ageDays: 1, note: '', folders: [], tags: [], url: 'https://example.invalid/1', source: 'rank' }], folders: [] },
      filters: { q: '', site: '', folder: '', tag: '' },
      subs: new Set(), map: {}, total: 1,
    },
  }
  const { mod, mount } = loadInteractive({ shared, routes: { '/bookmarks': shared.bookmarks.list, '/bookmarks/trash': { trash: [] }, '/bookmark': { __reject: '写盘失败' } } })
  const app = mount(mod.__test.components.BookmarksTab, { openLink() {} })
  let tree = await app.flush()
  click(tree, '＋ 备注')
  tree = app.render()
  const ta = nodesOf(tree, (n) => n.type === 'textarea')[0]
  assert.ok(ta, '点备注后必须出现编辑框')
  tree = app.act(() => ta.props.onChange({ target: { value: '写了一半的备注' } }))
  click(tree, '保存')
  tree = await app.flush()
  const ta2 = nodesOf(tree, (n) => n.type === 'textarea')[0]
  assert.ok(ta2, '保存失败后编辑框不许消失（草稿要留着）')
  assert.equal(ta2.props.value, '写了一半的备注', '失败后草稿内容不许被清掉')
  assert.match(textOf(tree), /保存失败/, '失败要在原地说明')
})

test('★ 即时开关失败要回退（界面不许说一套、服务端做另一套）', async () => {
  const { mod, mount } = loadInteractive({
    routes: { '/catalog': CATALOG, '/timer-plan': { ok: true, plan: { now: '10:00', today: '2026-10-22', enabled: true } }, '/timer': { __reject: '服务没接上' } },
  })
  const app = mount(mod.__test.components.SettingsTab, { ov: ovFixture(), onSaved() {} })
  let tree = await app.flush()
  click(tree, '▸ 扫描计划')
  tree = app.render()
  const swLabel = nodesOf(tree, (n) => n.type === 'label' && /已开启/.test(textOf(n)))[0]
  assert.ok(swLabel, '扫描计划里要有开关')
  const box = nodesOf(swLabel, (n) => n.type === 'input' && n.props.type === 'checkbox')[0]
  assert.equal(box.props.checked, true, '目录里 enabled=true ⇒ 开关初始为开')
  tree = app.act(() => box.props.onChange({ target: { checked: false } }))
  tree = await app.flush()
  const swLabel2 = nodesOf(tree, (n) => n.type === 'label' && /已(开启|关闭)/.test(textOf(n)))[0]
  assert.ok(swLabel2, '回退后开关还在')
  const box2 = nodesOf(swLabel2, (n) => n.type === 'input' && n.props.type === 'checkbox')[0]
  assert.equal(box2.props.checked, true, '失败后必须回退到原状态（开）')
  assert.match(textOf(tree), /已恢复原状态/)
})

test('★ 离开保护：有未保存草稿时切页/收起先拦，草稿保留', async () => {
  const { mod, mount } = loadInteractive({
    routes: {
      '/catalog': CATALOG,
      '/timer-plan': { ok: true, plan: { now: '10:00', today: '2026-10-22', enabled: true } },
      '/overview': ovFixture(),
    },
  })
  // ① 先在设置里改一个计划时刻 ⇒ 草稿（含计划草稿）
  const settings = mount(mod.__test.components.SettingsTab, { ov: ovFixture(), onSaved() {} })
  let st = await settings.flush()
  click(st, '▸ 扫描计划')
  st = settings.render()
  const timeInput = nodesOf(st, (n) => n.type === 'input' && n.props.type === 'time')[0]
  assert.ok(timeInput, '扫描计划里要有时刻输入')
  st = settings.act(() => timeInput.props.onChange({ target: { value: '05:15' } }))
  st = await settings.flush()
  assert.match(textOf(st), /时刻有改动，未保存/, '改时刻后要显示未保存')

  // ② 打开面板：切页应被拦下
  const panel = mount(mod.__test.components.Panel, { openLink() {} })
  let pt = await panel.flush()
  assert.ok(textOf(pt).indexOf('概览') >= 0, '面板要能渲染')
  click(pt, '榜单')
  pt = panel.render()
  assert.match(textOf(pt), /有未保存的改动/, '有草稿时切页要先拦一下')
  assert.match(textOf(pt), /设置草稿/, '要说明是哪一类草稿')
  click(pt, '继续编辑')
  pt = panel.render()
  assert.ok(!/有未保存的改动/.test(textOf(pt)), '选「继续编辑」后提示条消失')
  // ③ 再来一次，选「仍然离开」⇒ 真的切过去
  click(pt, '榜单')
  pt = panel.render()
  click(pt, '仍然离开')
  pt = panel.render()
  assert.ok(!/有未保存的改动/.test(textOf(pt)), '离开后提示条消失')
  assert.ok(textOf(pt).indexOf('更多 ▾') >= 0, '已经切到榜单页（榜单工具栏在）')
  assert.ok(textOf(pt).indexOf('今天的变化') < 0, '概览的内容不该还留着')
})
