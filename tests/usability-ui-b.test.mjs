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
    console, Promise, JSON, Math, Number, String, Object, Array, Date, RegExp, Error, AbortController,
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

test('列按可用宽度装：宽面板一列不少，变窄从最不重要的列开始收，核心列永远在', () => {
  const { fitColumns } = load().mod.__test.helpers
  const cols = [
    { key: 'rank', label: '名次' }, { key: 'delta', label: '变化' }, { key: 'title', label: '书名' },
    { key: 'author', label: '作者' }, { key: 'cat', label: '分类' }, { key: 'words', label: '字数' },
    { key: 'value', label: '首订' }, { key: 'collect', label: '收藏' }, { key: 'ratio', label: '收订比' },
    { key: 'fans', label: '粉丝' },
  ]
  const keys = cols.map((c) => c.key)
  assert.deepEqual(fitColumns(cols, 1600).map((c) => c.key), keys, '宽面板一列都不许少')
  // 560px：先收 粉丝(4)/分类(5)，作者与收藏这类还留着 —— 不再「一刀切只剩三列、右边一片空白」
  assert.deepEqual(fitColumns(cols, 560).map((c) => c.key), ['rank', 'delta', 'title', 'words', 'value', 'collect', 'ratio'])
  // 320px：只保核心列（名次/变化/书名/该榜主指标）
  assert.deepEqual(fitColumns(cols, 320).map((c) => c.key), ['rank', 'delta', 'title', 'value'])
  assert.deepEqual(fitColumns([], 700), [])
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
  assert.match(SRC, /补齐缺失/, '全站补全挪到设置，但能力不许丢')
})

test('★ 榜单：条数「保存」与「保存并扫描本榜」分开；历史入口按能力出现', () => {
  assert.match(SRC, /'扫描本榜（联网）'/)
  assert.match(SRC, /'保存'/)
  assert.match(SRC, /'保存并扫描本榜'/)
  assert.match(SRC, /const canDay = canDayQuery\(curBoard\)/, '历史入口必须按榜能力分支')
  assert.ok(!SRC.includes('menuItems'), '榜单页的更多菜单（含输入框）必须移除')
  assert.match(SRC, /条数已保存，但扫描失败/, '保存成功/采集失败要分开回执')
  assert.match(SRC, /正在查看历史：/, '看历史必须显式标出')
  assert.match(SRC, /无可比基准/, '没有基准不许报 0')
  assert.match(SRC, /新期：变化不可比/)
})

test('面板：四页签短名 + 无最大化按钮 + Esc 分层关闭', () => {
  for (const label of ["'概览'", "'榜单'", "'书签'", "'设置'"]) assert.ok(SRC.indexOf(label) >= 0, '缺页签：' + label)
  // ★ 2026-10-23：最大化整块去掉（跟宿主的顶栏/窗口按钮必然打架），只留拖动与缩放
  assert.ok(SRC.indexOf("'最大化'") < 0, '不许再有「最大化」按钮（注释里说明为什么去掉可以）')
  assert.ok(SRC.indexOf('toggleMax') < 0, '最大化切换逻辑要一并删掉，别留死代码')
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
    // ★ 与 React 一致：useCallback 按依赖记忆。否则 effect 的依赖永远「变了」⇒ 每轮渲染都重发请求，
    //   测试就会对着一个真实 React 里不存在的循环下结论（2026-10-24 修）。
    useCallback: (fn, deps) => {
      const c = H.cur
      const i = c.idx++
      const prev = c.memos[i]
      if (prev && deps && sameDeps(prev.deps, deps)) return prev.fn
      c.memos[i] = { fn, deps }
      return fn
    },
    useMemo: (fn) => fn(),
    Component: Cmp,
    Fragment: 'Fragment',
  }
  function sameDeps(a, b) {
    if (!a || !b || a.length !== b.length) return false
    return a.every((x, i) => x === b[i])
  }
  function mount(Comp, props) {
    const c = { state: {}, refs: {}, memos: {}, effs: {}, ran: {}, idx: 0, dirty: false }
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
    // 带查询串的读取（/board?boardId=…）也认不带查询的键：夹具按路由注册，不必逐个拼 query
    const keyNoQuery = key.split('?')[0]
    const hit = Object.prototype.hasOwnProperty.call(routes, key) ? key
      : Object.prototype.hasOwnProperty.call(routes, keyNoQuery) ? keyNoQuery : null
    const body = hit === null ? {} : routes[hit]
    if (body && body.__reject) return Promise.reject(new Error(body.__reject))
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }
  const sandbox = {
    console, Promise, JSON, Math, Number, String, Object, Array, Date, RegExp, Error, AbortController,
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
  const daySel = nodesOf(tree, (n) => n.type === 'select' && (n.children || []).some((c) => c && c.type === 'option' && c.props && c.props.value === '__day'))[0]
  assert.ok(daySel, '首订榜日期选择器里必须有「按上架日回看…」')
  tree = app.act(() => daySel.props.onChange({ target: { value: '__day' } }))
  const dateInput = nodesOf(tree, (n) => n.type === 'input' && n.props.type === 'date')[0]
  assert.ok(dateInput, '首订榜必须能按上架日回看（能力驱动入口在日期选择器里）')
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
  assert.match(mod.__test.lastNote.get(), /已恢复原状态/)
})

test('★ 设置保存成功：走 /select、底栏回「已保存」、Toast 里有一条 success', async () => {
  const { mod, mount, calls } = loadInteractive({
    routes: {
      '/catalog': CATALOG,
      '/timer-plan': { ok: true, plan: { now: '10:00', today: '2026-10-22', enabled: true } },
      '/select': { ok: true, note: '间隔已保存' },
      '/overview': ovFixture(),
    },
  })
  const app = mount(mod.__test.components.SettingsTab, { ov: ovFixture(), onSaved() {} })
  let tree = await app.flush()
  const dataBtn = nodesOf(tree, (n) => n.type === 'button' && /数据与性能/.test(textOf(n)))[0]
  assert.ok(dataBtn, '要有「数据与性能」分组')
  tree = app.act(() => dataBtn.props.onClick({ preventDefault() {}, stopPropagation() {}, target: {} }))
  const secBtn = nodesOf(tree, (n) => n.type === 'button' && /高级：请求间隔/.test(textOf(n)))[0]
  assert.ok(secBtn, '要有「高级：请求间隔」分组')
  tree = app.act(() => secBtn.props.onClick({ preventDefault() {}, stopPropagation() {}, target: {} }))
  const sel = nodesOf(tree, (n) => n.type === 'select' && n.props.value === '1000')[0]
  assert.ok(sel, '高级里要有请求间隔 select')
  tree = app.act(() => sel.props.onChange({ target: { value: '2000' } }))
  assert.match(textOf(tree), /有 1 处未保存：请求间隔/)
  click(tree, '保存设置')
  tree = await app.flush()
  const selCall = calls.filter((c) => c.url.indexOf('/select') >= 0).pop()
  assert.ok(selCall, '保存必须发 /select')
  assert.equal(selCall.body.requestIntervalMs, 2000, '/select 要带上草稿里的新间隔')
  assert.match(textOf(tree), /已保存/, '成功后底栏回「已保存」')
  const toastTree = mount(mod.__test.components.ToastHost, {}).render()
  assert.match(textOf(toastTree), /间隔已保存/, 'Toast 里要有宿主返回的成功提示')
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
  assert.match(textOf(st), /有 1 处未保存：计划时刻/, '改时刻后要显示未保存')

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
  assert.ok(/扫描本榜|本榜设置/.test(textOf(pt)), '已经切到榜单页（榜单工具栏在）')
  assert.ok(textOf(pt).indexOf('今天的变化') < 0, '概览的内容不该还留着')
})

/* ────────────────────────────────────────────────────────────────
 * Spec 审查 A–E（2026-10-24）：历史直查返回最新/独立元数据、窄窗详情字段、
 * 书签跨本切换草稿、概览扫描进度、设置吸底保存条。
 * 全部用真实 hooks + 受控网络（fetch 记录/可挂起），不只看源码字符串。
 * ──────────────────────────────────────────────────────────────── */
function boardFixture(over) {
  return {
    boardId: 'qidiantu.shouding',
    columns: [{ key: 'rank', label: '名次' }, { key: 'delta', label: '变化' }, { key: 'title', label: '书名' }, { key: 'value', label: '首订' }],
    rows: [{ key: '1001', rank: 1, title: '最新书', value: 9000, url: 'https://example.invalid/1001', delta: 2, extra: {} }],
    dates: ['2026-10-20', '2026-10-21'],
    dataDate: '2026-10-21',
    baselineDate: '2026-10-20',
    sortOptions: [{ value: '', label: '默认' }],
    ...over,
  }
}
const OV_QD = ovFixture({
  sites: [{ site: 'qidiantu', siteName: '起点图', boards: [{ boardId: 'qidiantu.shouding', name: '首订榜', status: 'ok', up: 1, newCount: 0, out: 0, lastCapture: '2026-10-21T05:30:00Z', note: null, derived: false, displayed: true }] }],
})
async function openDayInput(app) {
  let tree = await app.flush()
  const sel = nodesOf(tree, (n) => n.type === 'select' && (n.children || []).some((c) => c && c.type === 'option' && c.props && c.props.value === '__day'))[0]
  assert.ok(sel, '首订榜日期选择器里必须有「按上架日回看…」')
  tree = app.act(() => sel.props.onChange({ target: { value: '__day' } }))
  const input = nodesOf(tree, (n) => n.type === 'input' && n.props.type === 'date')[0]
  assert.ok(input, '首订榜必须有按上架日回看入口')
  return { tree, input }
}
async function openDayView(app, dateText) {
  const { tree, input } = await openDayInput(app)
  let next = app.act(() => input.props.onChange({ target: { value: dateText } }))
  click(next, '查看')
  return app.flush()
}

test('★ Spec A：直查历史后「回到最新」必须真的重新 GET 最新，不卡加载中', async () => {
  const board = boardFixture()
  const { mod, mount, calls } = loadInteractive({
    routes: {
      '/catalog': CATALOG,
      '/board': board,
      '/day': { ok: true, date: '2026-10-21', contentDate: '2026-10-20', rowsAll: [{ key: 'x', rank: 9, title: '直查书', value: 123, url: 'https://example.invalid/x' }], note: '直查站点 2026-10-21' },
    },
  })
  const app = mount(mod.__test.components.BoardTab, { ov: OV_QD, openLink() {}, narrow: false, width: 900, rev: 'r1' })
  let tree = await app.flush()
  assert.match(textOf(tree), /最新书/)
  tree = await openDayView(app, '2026-10-20')
  assert.match(textOf(tree), /正在查看历史：2026-10-21/)
  assert.match(textOf(tree), /直查书/)
  // 站点最新一版换了内容：回到最新必须真的取到它
  board.rows = [{ key: '1002', rank: 1, title: '回到最新后的书', value: 8000, url: 'https://example.invalid/1002', delta: 3, extra: {} }]
  const before = calls.filter((c) => c.url.indexOf('/board') >= 0).length
  click(tree, '回到最新')
  tree = await app.flush()
  tree = await app.flush()
  const boardCalls = calls.filter((c) => c.url.indexOf('/board') >= 0)
  assert.equal(boardCalls.length, before + 1, '「回到最新」必须真的发一次 /board（旧实现 sd/ss 未变 ⇒ 不发请求）')
  assert.ok(boardCalls[boardCalls.length - 1].url.indexOf('date=') < 0, '回到最新不许再带历史日期：' + boardCalls[boardCalls.length - 1].url)
  assert.match(textOf(tree), /回到最新后的书/)
  assert.ok(!/正在查看历史/.test(textOf(tree)), '回到最新后历史横幅要消失')
  assert.ok(!/加载中…/.test(textOf(tree)), '不许停在加载中')
})

test('★ Spec A：本地已选历史日期时「回到最新」同样回到无日期的最新视图', async () => {
  const board = boardFixture()
  const { mod, mount, calls } = loadInteractive({ routes: { '/catalog': CATALOG, '/board': board } })
  const app = mount(mod.__test.components.BoardTab, { ov: OV_QD, openLink() {}, narrow: false, width: 900, rev: 'r1' })
  let tree = await app.flush()
  const dateSel = nodesOf(tree, (n) => n.type === 'select')[2]
  assert.ok(dateSel, '工具栏要有日期选择')
  tree = app.act(() => dateSel.props.onChange({ target: { value: '2026-10-20' } }))
  tree = await app.flush()
  const withDate = calls.filter((c) => c.url.indexOf('/board') >= 0).pop()
  assert.ok(withDate.url.indexOf('date=2026-10-20') >= 0, '选历史日期要按该日取：' + withDate.url)
  board.rows = [{ key: '1003', rank: 1, title: '无日期最新书', value: 7000, url: 'https://example.invalid/1003', delta: 1, extra: {} }]
  const before = calls.filter((c) => c.url.indexOf('/board') >= 0).length
  click(tree, '回到最新')
  tree = await app.flush()
  tree = await app.flush()
  const after = calls.filter((c) => c.url.indexOf('/board') >= 0)
  assert.equal(after.length, before + 1, '必须重新取一次')
  assert.ok(after[after.length - 1].url.indexOf('date=') < 0, '回到最新必须去掉 date 参数：' + after[after.length - 1].url)
  assert.match(textOf(tree), /无日期最新书/)
})

test('★ Spec A：旧请求晚到不许覆盖新选择（直查/回到最新期间的乱序防护）', async () => {
  const oldBoard = boardFixture()
  const routes = { '/catalog': CATALOG, '/board': oldBoard }
  const { mod, mount, sandbox } = loadInteractive({ routes })
  const held = []
  const baseFetch = sandbox.fetch
  let holdNext = false
  sandbox.fetch = function (url, init) {
    const p = baseFetch(url, init)
    if (holdNext && String(url).indexOf('/board') >= 0) {
      holdNext = false
      return new Promise(function (resolve) { held.push(function () { resolve(p) }) })
    }
    return p
  }
  const app = mount(mod.__test.components.BoardTab, { ov: OV_QD, openLink() {}, narrow: false, width: 900, rev: 'r1' })
  let tree = await app.flush()
  assert.match(textOf(tree), /最新书/)
  // 选历史日期：这次请求先挂住（模拟慢响应）
  holdNext = true
  const dateSel = nodesOf(tree, (n) => n.type === 'select')[2]
  tree = app.act(() => dateSel.props.onChange({ target: { value: '2026-10-20' } }))
  assert.equal(held.length, 1, '慢请求应当被挂住')
  // 站点数据换了，点「回到最新」发第二个请求（正常返回）
  routes['/board'] = boardFixture({ rows: [{ key: '1005', rank: 1, title: '新选择的书', value: 1, url: 'https://example.invalid/5', delta: 1, extra: {} }] })
  click(tree, '回到最新')
  tree = await app.flush()
  tree = await app.flush()
  assert.match(textOf(tree), /新选择的书/)
  // 迟到的旧响应这时才放行：界面必须还是新选择
  held.forEach(function (f) { f() })
  tree = await app.flush()
  tree = await app.flush()
  assert.match(textOf(tree), /新选择的书/, '旧响应晚到不许覆盖新选择')
  assert.ok(!/最新书/.test(textOf(tree)), '旧数据不许被写回界面')
})

test('★ Spec A：直查期间本地快照修订号变化，不许把站点历史悄悄换成最新视图', async () => {
  const board = boardFixture()
  const props = { ov: OV_QD, openLink() {}, narrow: false, width: 900, rev: 'r1' }
  const { mod, mount, calls } = loadInteractive({
    routes: {
      '/catalog': CATALOG,
      '/board': board,
      '/day': { ok: true, date: '2026-10-21', contentDate: '2026-10-20', rowsAll: [{ key: 'x', rank: 9, title: '直查书', value: 123, url: 'https://example.invalid/x' }], note: '直查站点 2026-10-21' },
    },
  })
  const app = mount(mod.__test.components.BoardTab, props)
  let tree = await app.flush()
  const opened = await openDayInput(app)
  tree = app.act(() => opened.input.props.onChange({ target: { value: '2026-10-20' } }))
  click(tree, '查看')
  tree = await app.flush()
  assert.match(textOf(tree), /正在查看历史：2026-10-21/)
  const before = calls.filter((c) => c.url.indexOf('/board') >= 0).length
  // 后台扫描完成 ⇒ 修订号变了
  props.rev = 'r2'
  tree = await app.flush()
  tree = await app.flush()
  assert.match(textOf(tree), /正在查看历史：2026-10-21/, '直查视图必须还在')
  assert.match(textOf(tree), /直查书/, '内容不能被本地最新快照替换')
  assert.equal(calls.filter((c) => c.url.indexOf('/board') >= 0).length, before, '直查期间不许静默重读本地榜覆盖视图')
})

test('★ Spec B：直查视图用独立元数据 —— 不沿用旧基准/补全统计/回落信息', async () => {
  const board = boardFixture({ baselineDate: '2026-10-20', enrich: { missing: 5 }, fallbackFrom: '2026-10-19', requestedDate: '2026-10-18' })
  const { mod, mount } = loadInteractive({
    routes: {
      '/catalog': CATALOG,
      '/board': board,
      '/day': { ok: true, date: '2026-10-21', contentDate: '2026-10-20', rowsAll: [{ key: 'x', rank: 9, title: '直查书', value: 123, url: 'https://example.invalid/x' }], note: '直查站点 2026-10-21' },
    },
  })
  const app = mount(mod.__test.components.BoardTab, { ov: OV_QD, openLink() {}, narrow: false, width: 900, rev: 'r1' })
  let tree = await app.flush()
  assert.match(textOf(tree), /对比 2026-10-20/, '本地视图本来有基准')
  tree = await openDayView(app, '2026-10-20')
  const txt = textOf(tree)
  assert.match(txt, /数据日期 2026-10-21/, '直查视图的数据日期要写实际返回日')
  assert.match(txt, /内容日期 2026-10-20/, '首订 n-1：内容日期（上架日）与数据日期不是一回事')
  assert.match(txt, /无可比基准/, '直查没有本地基准 ⇒ 必须明说无可比基准')
  assert.ok(!/对比 2026-10-20/.test(txt), '不许沿用上一视图的比较基准（会显示基准晚于数据日）')
  assert.ok(!/补全未完成：还缺 5 条/.test(txt), '直查行没有补全统计，不许沿用')
  assert.ok(!/没有快照 ⇒ 回落到/.test(txt), '直查不是回落视图')
  const dashCells = nodesOf(tree, (n) => n.type === 'td' && textOf(n).trim() === '—')
  assert.ok(dashCells.length >= 1, '直查行的变化列一律「—」（不报 0）')
})

test('★ Spec C：窄窗/装列丢掉的字段能在行详情里完整展开（分类/子分类/在榜天数/超出 chip 的指标）', async () => {
  const cols = [
    { key: 'rank', label: '名次' }, { key: 'title', label: '书名' }, { key: 'author', label: '作者' },
    { key: 'cat', label: '分类' }, { key: 'subCat', label: '子分类' }, { key: 'days', label: '在榜天数' },
    { key: 'value', label: '首订' }, { key: 'collect', label: '收藏' }, { key: 'words', label: '字数' },
    { key: 'updated', label: '更新' },
  ].concat([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ key: 'daily' + i, label: 'D' + (i + 1) })))
  // 与 host 的真实结构一致：逐日增量在 extra.daily 数组里（daily0..dailyN 只是列键）
  const extra = { cat: '玄幻', subCat: '东方玄幻', collect: 12345, wordsCnt: 300000, lastChapterUpdateTime: '2026-10-21T10:00:00Z', daily: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ delta: n })) }
  const board = boardFixture({
    columns: cols,
    rows: [{ key: '2001', rank: 2, title: '详情书', author: '作者甲', days: 12, value: 5000, url: 'https://example.invalid/2001', delta: 1, extra }],
  })
  const { mod, mount } = loadInteractive({ routes: { '/catalog': CATALOG, '/board': board } })
  // 500px ⇒ 卡片行；chip 只放得下 6 个指标，其余必须能从详情看到
  const app = mount(mod.__test.components.BoardTab, { ov: OV_QD, openLink() {}, narrow: true, width: 500, rev: 'r1' })
  let tree = await app.flush()
  assert.ok(!/分类：/.test(textOf(tree)), '默认视图收起次级列（还没展开详情）')
  const card = nodesOf(tree, (n) => n.type === 'div' && typeof n.props.onClick === 'function' && textOf(n).indexOf('详情书') >= 0)[0]
  assert.ok(card, '窄面板要渲染卡片行')
  tree = app.act(() => card.props.onClick({}))
  const txt = textOf(tree)
  assert.match(txt, /分类：\s*玄幻/, '被收起的分类必须能在详情里看到')
  assert.match(txt, /子分类：\s*东方玄幻/, '子分类同理')
  assert.match(txt, /在榜天数：\s*12/, '在榜天数必须能显式查看')
  assert.match(txt, /D4：\s*\+4/, '超出 6 个 chip 的指标也要能在详情里看到（不截断真实字段）')
  assert.match(txt, /D8：\s*\+8/, '最后一列同样不许截断')
})

test('Spec D：筛选隐藏正在编辑的书签后切本仍保护草稿，跨页恢复亦然', async () => {
  const shared = bmShared(BM_TWO)
  const routes = { '/bookmarks': shared.bookmarks.list }
  const { mod, mount, sandbox } = loadInteractive({ shared, routes })
  const storage = {}
  sandbox.sessionStorage = { getItem: k => storage[k] || null, setItem: (k, v) => { storage[k] = v } }
  const app = mount(mod.__test.components.BookmarksTab, {})
  let tree = await app.flush()
  click(tree, '＋ 备注'); tree = app.render()
  const textarea = nodesOf(tree, n => n.type === 'textarea')[0]
  tree = app.act(() => textarea.props.onChange({ target: { value: '筛选前A草稿' } }))
  shared.bookmarks.list = { bookmarks: [BM_TWO[1]], folders: [] }
  routes['/bookmarks'] = shared.bookmarks.list
  shared.bookmarks.total = 1
  shared.bookmarks.filters.q = '书B'
  tree = await app.flush(); tree = await app.flush()
  click(tree, 'B原备注'); tree = app.render()
  assert.match(textOf(tree), /放弃并切换/)
  click(tree, '继续编辑'); tree = app.render()
  const drafts = JSON.parse(sandbox.sessionStorage.getItem('rank-scan-panel:drafts:v1'))
  assert.equal(drafts.bm.note, '筛选前A草稿')
  assert.equal(drafts.bm.dirty, true)
  const returned = mount(mod.__test.components.BookmarksTab, {})
  tree = await returned.flush()
  click(tree, 'B原备注'); tree = returned.render()
  assert.match(textOf(tree), /放弃并切换/)
  click(tree, '放弃并切换'); tree = returned.render()
  assert.equal(nodesOf(tree, n => n.type === 'textarea')[0].props.value, 'B原备注')
})

function bmShared(items) {
  return {
    bookmarks: {
      list: { bookmarks: items, folders: [] },
      filters: { q: '', site: '', folder: '', tag: '' },
      subs: new Set(), map: {}, total: items.length,
    },
  }
}
const BM_TWO = [
  { bookKey: 'qidian:1', label: '书A', author: '某人', site: 'qidian', note: '', folders: [], tags: [], url: 'https://example.invalid/a', source: 'rank', collect: 100 },
  { bookKey: 'qidian:2', label: '书B', author: '另一人', site: 'qidian', note: 'B原备注', folders: [], tags: [], url: 'https://example.invalid/b', source: 'rank', collect: 200 },
]

test('★ Spec D：编辑 A 未保存就切 B 必须先问；继续编辑保 A；同本重复点不清草稿', async () => {
  const shared = bmShared(BM_TWO)
  const { mod, mount } = loadInteractive({ shared, routes: { '/bookmarks': shared.bookmarks.list, '/bookmark': { ok: true } } })
  const app = mount(mod.__test.components.BookmarksTab, { openLink() {} })
  let tree = await app.flush()
  click(tree, '＋ 备注') // A：无备注
  tree = app.render()
  const ta0 = nodesOf(tree, (n) => n.type === 'textarea')[0]
  tree = app.act(() => ta0.props.onChange({ target: { value: 'A 的草稿' } }))
  // 同一条再点一次（按钮上的文字是**已保存**的备注，草稿不进去）：不许把草稿清回原值
  click(tree, '＋ 备注')
  tree = app.render()
  assert.equal(nodesOf(tree, (n) => n.type === 'textarea')[0].props.value, 'A 的草稿', '同一条书签重复点编辑不许清掉草稿')
  // 已有放弃确认时切本，必须只保留一种确认条。
  click(tree, '取消'); tree = app.render()
  // 切到 B：必须先问，且问的时候 A 的草稿不动
  click(tree, 'B原备注')
  tree = app.render()
  assert.match(textOf(tree), /继续编辑/, '切到另一条书签要先给「继续编辑」')
  assert.match(textOf(tree), /放弃并切换/, '并给出「放弃并切换」')
  assert.equal(nodesOf(tree, n => n.type === 'button' && textOf(n).trim() === '继续编辑').length, 1)
  assert.equal(nodesOf(tree, (n) => n.type === 'textarea')[0].props.value, 'A 的草稿', '询问期间不许把 A 的草稿换掉')
  click(tree, '继续编辑')
  tree = app.render()
  assert.equal(nodesOf(tree, (n) => n.type === 'textarea')[0].props.value, 'A 的草稿', '选继续编辑后 A 的草稿还在')
  assert.ok(!/放弃并切换/.test(textOf(tree)), '选继续编辑后提示要收掉')
  // 再来一次，这回确认放弃并切换
  click(tree, 'B原备注')
  tree = app.render()
  click(tree, '放弃并切换')
  tree = app.render()
  assert.equal(nodesOf(tree, (n) => n.type === 'textarea')[0].props.value, 'B原备注', '确认切换后才允许换成 B 的备注')
})

test('★ Spec D：A 保存进行中切到 B，异步完成不许清掉 B 的编辑态与草稿', async () => {
  const shared = bmShared(BM_TWO)
  const { mod, mount } = loadInteractive({ shared, routes: { '/bookmarks': shared.bookmarks.list, '/bookmark': { ok: true } } })
  const app = mount(mod.__test.components.BookmarksTab, { openLink() {} })
  let tree = await app.flush()
  click(tree, '＋ 备注')
  tree = app.render()
  const ta0 = nodesOf(tree, (n) => n.type === 'textarea')[0]
  tree = app.act(() => ta0.props.onChange({ target: { value: 'A 要保存的' } }))
  click(tree, '保存') // 发起保存（异步）
  click(tree, 'B原备注') // 保存还没回来就切 B
  tree = app.render()
  click(tree, '放弃并切换')
  tree = app.render()
  tree = await app.flush() // 保存的 then 这时才跑完
  const ta = nodesOf(tree, (n) => n.type === 'textarea')[0]
  assert.ok(ta, 'B 的编辑框必须还在（旧实现保存完成会连 B 一起 closeEdit）')
  assert.equal(ta.props.value, 'B原备注', 'B 的备注不许被 A 的保存回调清掉')
})

test('★ Spec E：概览运行中显示扫描进度（done/total）与取消，不重复成多块进度', () => {
  const { mod } = load()
  const Overview = mod.__test.components.Overview
  const running = ovFixture({ scan: { outcome: 'running', attempt: 1, trigger: 'manual', progress: { done: 3, total: 10 }, warnings: [] } })
  const txt = textOf(expand(Overview({ ov: running, busy: true, act() {}, reload() {}, narrow: false, rev: 'r1' })))
  assert.match(txt, /扫描中 3\/10/, '运行中主按钮要显示已完成/总数')
  assert.match(txt, /停止本次/, '运行中必须能取消')
  assert.equal((txt.match(/扫描中/g) || []).length, 1, '扫描进度只占一个主要位置')
  const idle = textOf(expand(Overview({ ov: ovFixture(), busy: false, act() {}, reload() {}, narrow: false, rev: 'r1' })))
  assert.match(idle, /扫描已选榜/)
  assert.ok(!/扫描中/.test(idle), '没在跑时不许显示扫描进度')
})

test('★ Spec E：默认摘要说人话（不出现「接线」）；吸底保存条在设置层，折叠抓取范围也能保存', async () => {
  const timerPlan = { now: '15:00', today: '2026-10-22', enabled: true, installedToday: false, siteTimes: { qidian: '01:30' }, fallbackTime: '22:30', siteLastScan: {}, staleSites: [], due: [], fallback: [], done: [], waiting: [] }
  const { mod, mount, calls } = loadInteractive({ routes: { '/catalog': CATALOG, '/timer-plan': timerPlan, '/select': { ok: true, note: '已保存' } } })
  const app = mount(mod.__test.components.SettingsTab, { ov: ovFixture(), onSaved() {} })
  let tree = await app.flush()
  assert.ok(!/接线/.test(textOf(tree)), '默认摘要不许出现「接线」这类实现词')
  assert.match(textOf(tree), /自动扫描/, '要能让用户读懂自动扫描是否生效')
  // 收起「抓取范围」——旧实现里保存条就在这个分组内，一折叠就看不到
  click(tree, '▾ 抓取范围（1 个榜）')
  tree = app.render()
  click(tree, '▸ 数据与性能')
  tree = app.render()
  const lab = nodesOf(tree, (n) => n.type === 'label' && /自动补全/.test(textOf(n)))[0]
  assert.ok(lab, '设置里要有自动补全开关')
  const box = nodesOf(lab, (n) => n.type === 'input')[0]
  assert.equal(box.props.checked, true)
  tree = app.act(() => box.props.onChange({ target: { checked: false } }))
  assert.match(textOf(tree), /有 1 处未保存：自动补全/, '折叠抓取范围后改别的设置，也要看得到未保存状态')
  const saveBtn = nodesOf(tree, (n) => n.type === 'button' && /保存设置/.test(textOf(n)))[0]
  assert.ok(saveBtn, '保存条必须留在设置层，不随「抓取范围」折叠消失')
  saveBtn.props.onClick({})
  tree = await app.flush()
  const sel = calls.filter((c) => c.url.indexOf('/select') >= 0).pop()
  assert.ok(sel, '点保存要真的发 /select')
  assert.equal(sel.body.autoEnrich, false, '折叠状态下改的开关也要被保存')
})

test('Spec E：概览请求挂起会超时中止，后续读取可恢复', async () => {
  let expire, signal, count = 0
  const source = SRC.slice(SRC.indexOf('    const readOverview ='), SRC.indexOf('    // ⚠️ 之前这里'))
  const read = vm.runInNewContext(source + '\nreadOverview', {
    API: '/api/rank-scan', AbortController, Promise, Error,
    readResponse: response => response.json(),
    fetch: (_, init) => { signal = init.signal; return ++count === 1 ? new Promise(() => {}) : Promise.resolve({ json: async () => ({ recovered: true }) }) },
    setTimeout: fn => { expire = fn; return 1 }, clearTimeout() {},
  })
  const hung = read()
  expire()
  await assert.rejects(hung, /概览读取超时/)
  assert.equal(signal.aborted, true)
  assert.equal((await read()).recovered, true)
})

function directRoutes(board) {
  return { '/catalog': CATALOG, '/board': board, '/day': { ok: true, date: '2026-10-21', contentDate: '2026-10-20', rowsAll: [{ key: 'direct', rank: 1, title: '直查边界书', value: 123 }], note: '站点直查夹具' } }
}

test('Spec A：非默认排序直查保留历史；主动改排序后退出直查', async () => {
  const board = boardFixture({ sortOptions: [{ value: '', label: '默认' }, { value: 'rank', label: '名次' }] })
  const { mod, mount, calls, sandbox } = loadInteractive({ routes: directRoutes(board) })
  const app = mount(mod.__test.components.BoardTab, { ov: OV_QD, width: 900, rev: 'r1' })
  let tree = await app.flush()
  const sort = () => nodesOf(tree, n => n.type === 'select')[3]
  tree = app.act(() => sort().props.onChange({ target: { value: 'rank' } }))
  tree = await app.flush(); tree = await app.flush()
  assert.match(calls.filter(c => c.url.includes('/board')).at(-1).url, /sort=rank/)
  const before = calls.filter(c => c.url.includes('/board')).length
  tree = await openDayView(app, '2026-10-20'); tree = await app.flush()
  assert.match(textOf(tree), /直查边界书/)
  assert.match(textOf(tree), /正在查看历史：2026-10-21/)
  assert.equal(calls.filter(c => c.url.includes('/board')).length, before, '内部清排序不应启动本地读取')
  tree = app.act(() => sort().props.onChange({ target: { value: 'rank' } }))
  tree = await app.flush(); tree = await app.flush()
  assert.match(textOf(tree), /最新书/)
  assert.doesNotMatch(textOf(tree), /直查边界书/)
  // The query menu is still open after changing sort.
  click(tree, '查看'); tree = await app.flush(); tree = await app.flush()
  click(tree, '回到最新'); tree = await app.flush(); tree = await app.flush()
  const saved = JSON.parse(sandbox.localStorage.getItem('rank-scan-panel:sel:v1'))
  assert.equal(saved.sorts['qidiantu.shouding'], 'rank', '回到最新保留按榜排序记忆')
})

test('Spec A：同日重复存入本地也重读，并保持上架日 n-1 换算', async () => {
  const { mod, mount, calls } = loadInteractive({ routes: directRoutes(boardFixture()) })
  const app = mount(mod.__test.components.BoardTab, { ov: OV_QD, width: 900, rev: 'r1' })
  let tree = await app.flush()
  const opened = await openDayInput(app)
  tree = app.act(() => opened.input.props.onChange({ target: { value: '2026-10-20' } }))
  click(tree, '存入本地'); tree = await app.flush(); tree = await app.flush()
  const before = calls.filter(c => c.url.includes('/board')).length
  click(tree, '存入本地'); tree = await app.flush(); tree = await app.flush()
  const reads = calls.filter(c => c.url.includes('/board'))
  assert.equal(reads.length, before + 1)
  assert.match(reads.at(-1).url, /date=2026-10-21/)
  assert.deepEqual(calls.filter(c => c.url.endsWith('/day')).map(c => c.body), [
    { boardId: 'qidiantu.shouding', date: '2026-10-21', save: true },
    { boardId: 'qidiantu.shouding', date: '2026-10-21', save: true },
  ])
})

test('Spec A：返回最新读取失败保留历史内容，重试可恢复最新', async () => {
  const routes = directRoutes(boardFixture())
  const { mod, mount } = loadInteractive({ routes })
  const app = mount(mod.__test.components.BoardTab, { ov: OV_QD, width: 900, rev: 'r1' })
  let tree = await app.flush()
  tree = await openDayView(app, '2026-10-20'); tree = await app.flush()
  routes['/board'] = { __reject: '模拟最新读取失败' }
  click(tree, '回到最新'); tree = await app.flush(); tree = await app.flush()
  assert.match(textOf(tree), /直查边界书/)
  assert.match(textOf(tree), /读取失败/)
  routes['/board'] = boardFixture()
  click(tree, '重试'); tree = await app.flush(); tree = await app.flush()
  assert.match(textOf(tree), /最新书/)
  assert.doesNotMatch(textOf(tree), /直查边界书/)
})
