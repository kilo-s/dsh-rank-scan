import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/**
 * ★ 客户端 bundle 的「真加载」闸（ticket 45 / Q28）。
 *
 * 为什么 client-bundle.test.mjs 里的 new Function(src) 不够：
 *   它只把源码**解析**一遍（抓语法错误），factory 里的代码一行都没跑。
 *   于是「能解析、但一加载就抛」这一类缺陷完全漏网：
 *   - 模块顶层引用了只在 apply(ctx) 里存在的 ctx（每次加载抛 ReferenceError，
 *     又被自己的空 catch 吞掉 ⇒ 现场只剩「某个自检标记没有」这种无声症状）；
 *   - 顶层碰了没被桩住的宿主全局。
 *
 * 本闸用宿主**同形**的 window.__ModuleLoader__.load({ id, factory }) 在 VM 里真的执行
 * factory(require)（见 @deepseek-ai/dsh-client-modules：注册只登记工厂，materialize 才跑工厂体），
 * 再真的调一次 apply(ctx)，把槽位注册抓下来，验证入口 id 与 main 面板 id 对齐。
 *
 * 只测 client/client.js（入库的真源）：lib/client.js 是构建复制品，二者的字节一致性
 * 由 client-bundle.test.mjs 单独守。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'client', 'client.js')
/** 最小 React 桩：够跑 factory 顶层 + apply，也够直接调用纯展示组件 */
function makeFakeReact() {
  const createElement = function (type, props) {
    const children = Array.prototype.slice.call(arguments, 2)
    return { type, props: props || {}, children: children.flat(Infinity).filter(function (c) { return c !== undefined && c !== null && c !== false && c !== true }) }
  }
  function Component(props) { this.props = props || {} }
  Component.prototype.setState = function () {}
  return {
    createElement,
    useState: function (init) { return [typeof init === 'function' ? init() : init, function () {}] },
    useEffect: function () {},
    useLayoutEffect: function () {},
    useRef: function (v) { return { current: v } },
    useCallback: function (f) { return f },
    useMemo: function (f) { return typeof f === 'function' ? f() : f },
    Component,
    Fragment: 'Fragment',
  }
}

function makeLocalStorage(seed) {
  const map = new Map(Object.entries(seed || {}))
  return {
    getItem: function (k) { return map.has(k) ? map.get(k) : null },
    setItem: function (k, v) { map.set(k, String(v)) },
    removeItem: function (k) { map.delete(k) },
  }
}

/**
 * 用宿主同形的 ModuleLoader 契约加载并**物化** bundle。
 * ctx 故意作为沙箱全局存在（值 undefined）：模块求值期若引用它，症状会显现出来，
 * 而不是变成「裸标识符 ReferenceError 被空 catch 吞掉」这种查不到的无声故障。
 */
function loadBundle(sandboxExtras) {
  const src = readFileSync(SOURCE, 'utf8')
  const fakeReact = makeFakeReact()
  let registration = null
  const appended = []
  const sandbox = Object.assign({
    ctx: undefined,
    console: { log: function () {}, info: function () {}, warn: function () {}, error: function () {} },
    localStorage: makeLocalStorage(),
    location: { reload: function () {} },
    document: {
      createElement: function () { return { className: '', style: {}, textContent: '', setAttribute: function () {}, remove: function () {} } },
      body: { appendChild: function (el) { appended.push(el) } },
      documentElement: { appendChild: function (el) { appended.push(el) } },
      head: { append: function () {} },
      addEventListener: function () {}, removeEventListener: function () {},
      querySelectorAll: function () { return [] },
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}) } }) },
  }, sandboxExtras || {})
  sandbox.window = sandbox
  sandbox.window.innerWidth = 1200
  sandbox.window.innerHeight = 800
  sandbox.window.addEventListener = function () {}
  sandbox.window.removeEventListener = function () {}
  sandbox.window.__ModuleLoader__ = { load: function (r) { registration = r } }
  const context = vm.createContext(sandbox)
  // ① 脚本求值：只允许登记工厂（这一步就已经能抓「脚本级」抛错）
  vm.runInContext(src, context, { filename: 'client/client.js' })
  assert.ok(registration && typeof registration.factory === 'function', 'bundle 没有通过 window.__ModuleLoader__.load 登记工厂')
  // ② 物化：真的跑 factory(require)（宿主在第一次 import/require 时才会走到这里）
  const exportsObj = registration.factory(function (spec) {
    if (spec === 'react') return fakeReact
    throw new Error('client bundle 在加载期 require 了未声明的模块：' + spec)
  })
  return { sandbox, exportsObj, appended, registration, fakeReact }
}
/** apply(ctx) 的桩：把 slots.inject / slots.register 抓下来，并能把延迟注册的工厂跑掉 */
function makeFakeCtx() {
  const registrations = []
  const pending = []
  const ctx = {
    inject: function (_deps, cb) { if (typeof cb === 'function') cb(ctx) },
    logger: { info: function () {}, warn: function () {}, error: function () {}, debug: function () {} },
    slots: {
      inject: function (slot, factory) { pending.push({ slot, factory }); return function () {} },
      register: function (options, comp) { registrations.push({ options, comp }); return function () {} },
    },
  }
  const drain = function () {
    let guard = 0
    while (pending.length) {
      if (++guard > 100) throw new Error('slots.inject 工厂链没有收敛')
      const factory = pending.shift().factory
      const out = factory()
      if (out && typeof out.next === 'function') { let step = out.next(); while (!step.done) step = out.next() }
    }
  }
  return { ctx, registrations, drain }
}

function containsType(node, type) {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(function (n) { return containsType(n, type) })
  if (node.type === type) return true
  return containsType(node.children, type)
}

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object') return ''
  return textOf(node.children)
}
test('★ 真加载：factory(require) 在 VM 里跑通并返回 {name, inject, apply}', function () {
  const { exportsObj, appended, sandbox } = loadBundle()
  assert.ok(exportsObj && typeof exportsObj === 'object', 'factory 必须返回插件对象')
  assert.equal(exportsObj.name, 'dsh-rank-scan', '插件 id 必须是 dsh-rank-scan')
  assert.ok(Array.isArray(exportsObj.inject), 'inject 必须是数组')
  assert.equal(typeof exportsObj.apply, 'function', 'apply 必须是函数')
  // ★ 死码回归：模块**求值期**不许碰只在 apply(ctx) 里存在的 ctx。
  //   旧写法在顶层跑 diagLink(ctx) ⇒ ReferenceError 被空 catch 吞掉，只在别处留个无声症状。
  assert.equal(sandbox.__rankScanLinkDiag, undefined, '模块求值期引用了 apply 作用域的 ctx（旧死码），必须删掉')
  assert.equal(appended.length, 0, '模块求值期不应往 DOM 里塞自检标记节点')
})

test('★ apply(ctx) 真跑一遍：入口 id 必须落在 main 面板注册集合内（宿主 selectPanel 契约）', function () {
  const { exportsObj } = loadBundle()
  const { ctx, registrations, drain } = makeFakeCtx()
  exportsObj.apply(ctx)
  drain()
  const mains = registrations.filter(function (r) { return r.options && r.options.name === 'main' })
  const entry = registrations.find(function (r) { return r.options && r.options.name === 'sidebar.panellist' })
  assert.ok(entry, '必须注册 sidebar.panellist 入口（左栏面板行）')
  assert.ok(mains.length > 0, '必须注册一个 main 面板，否则宿主 layout.selectPanel(id) 抛「is not registered」')
  const mainKeys = mains.map(function (r) { return r.options.key })
  assert.ok(mainKeys.includes(entry.options.id), '入口 id ' + entry.options.id + ' 不在 main 面板集合 ' + JSON.stringify(mainKeys) + ' 内')
  assert.ok(entry.options.label, '入口必须带 label（宿主 PanelRow 用它做 aria-label / tooltip）')
})

test('★ 入口 occupant：就地弹浮窗的可点图标（不套 button、不把会话顶走）', function () {
  const { exportsObj } = loadBundle()
  const { ctx, registrations, drain } = makeFakeCtx()
  exportsObj.apply(ctx)
  drain()
  const entry = registrations.find(function (r) { return r.options && r.options.name === 'sidebar.panellist' })
  const el = entry.comp({ size: 16, active: false })
  assert.ok(el && typeof el === 'object', '入口 occupant 必须能直接用 { size, active } 渲染出元素')
  assert.notEqual(el.type, 'button', '入口 occupant 不许自己渲染 button（宿主 PanelRow 会再包一层 = 按钮套按钮）')
  assert.ok(!containsType(el, 'button'), '入口 occupant 子树里不许有 button')
  // 尺寸挂在图标本体上（外层是可点的 div 包装）——递归找 svg 的 width
  const svgWidth = function (node) {
    let w = null
    ;(function walk(n) {
      if (!n || typeof n !== 'object' || w != null) return
      if (n.type === 'svg') { w = (n.props || {}).width; return }
      ;(n.children || []).forEach(walk)
    })(node)
    return w
  }
  assert.equal(svgWidth(el), 16, '入口图标必须按宿主给的 size 渲染尺寸')
  assert.equal(svgWidth(entry.comp({ size: 18, active: true })), 18, 'size 变化必须跟随')
  // ★ 2026-10-16（使用者口径）：点入口要**就地弹浮窗**，且必须先 stopPropagation 挡住宿主 PanelRow 的
  //   selectPanel(id) —— 否则主区域被切到薄 main 面板，正在看的会话被顶走（这正是被投诉的行为）。
  assert.equal(typeof el.props.onClick, 'function', '入口必须可点（点了就地弹浮窗）')
  let stopped = false
  el.props.onClick({ stopPropagation: function () { stopped = true } })
  assert.ok(stopped, 'onClick 必须先 stopPropagation，挡掉宿主 selectPanel')
})

test('★ main 面板只作宿主契约落点：不渲染界面、装载即弹浮窗（2026-10-16 使用者改口径）', function () {
  const { exportsObj } = loadBundle()
  const { ctx, registrations, drain } = makeFakeCtx()
  exportsObj.apply(ctx)
  drain()
  const main = registrations.find(function (r) { return r.options && r.options.name === 'main' && r.options.key === 'rank-scan-panel' })
  assert.ok(main, '必须注册 id=rank-scan-panel 的 main 面板（宿主 layout.selectPanel 对未注册的 main id 会抛）')
  const tree = main.comp({})
  assert.equal(tree, null, 'main 面板不再渲染任何界面（使用者口径：不要「多一个界面再点里面的按钮」）')
  // 防漂移：装载时必须自动把浮窗打开（否则键盘/宿主路径落到这里会是一片空白）
  const src = readFileSync(SOURCE, 'utf8')
  assert.match(src, /RankScanMainPanel[\s\S]{0,240}panelOpen\.set\(true\)/, 'main 面板装载时必须自动打开浮窗')
})

test('★ 首次安装自动弹一次：标记只在**真的打开**的那一刻落（不再「标记落了但从不弹」）', function () {
  const { exportsObj, sandbox } = loadBundle()
  const first = makeFakeCtx()
  exportsObj.apply(first.ctx)
  first.drain()
  const shared = sandbox.__rankScanShared
  assert.ok(shared && shared.panelOpen, '没有模块级 panelOpen 单例')
  assert.equal(shared.panelOpen.value, true, '首次装载（无 autoopened 标记）必须真的把浮窗打开')
  assert.equal(sandbox.localStorage.getItem('rank-scan-panel:autoopened:v1'), '1', '打开的同时必须落标记')
  // 用户把浮窗关掉 ⇒ 标记已在，下次装载回到用户的选择，不再自动弹
  sandbox.localStorage.setItem('rank-scan-panel:open:v1', '0')
  const second = loadBundle({ localStorage: sandbox.localStorage, __rankScanShared: {} })
  const secondCtx = makeFakeCtx()
  second.exportsObj.apply(secondCtx.ctx)
  secondCtx.drain()
  assert.equal(second.sandbox.__rankScanShared.panelOpen.value, false, '标记已存在时不许再自动弹（应回到用户上次的关闭状态）')
  assert.equal(second.sandbox.localStorage.getItem('rank-scan-panel:autoopened:v1'), '1')

  // ★ 关键回归：只**加载**不 apply（插件没激活 / 槽位不在 / apply 抛错）时，不许消费这个标记。
  //   旧写法在模块求值期就 setItem ⇒ 一次没成功激活就把「首次自动弹」永久烧掉（标记落了但从不弹）。
  const idle = loadBundle()
  assert.equal(idle.sandbox.localStorage.getItem('rank-scan-panel:autoopened:v1'), null, 'apply 没跑就不许消费「首次自动弹」标记')
  assert.equal(idle.sandbox.__rankScanShared.panelOpen.value, false, 'apply 没跑时浮窗不该已经是打开状态')
})
test('★ 面板本地时刻（ticket 42 显示部分）：UTC ISO 串必须按本地时刻渲染，不许再 slice(11,16)', function () {
  const src = readFileSync(SOURCE, 'utf8')
  // 旧写法：String(hit.at).slice(11, 16) —— 取的是 UTC 的 HH:MM（东八区早 8 小时）
  assert.ok(!/slice\(11, 16\)/.test(src), '面板里仍有把 UTC ISO 串直接切片当本地时刻显示的写法')
  const start = src.indexOf('const asDate = (v) =>')
  const end = src.indexOf('function tone(status)')
  assert.ok(start > 0 && end > start, '取不到本地时刻格式化助手（fmtLocalHM / fmtLocalStamp）')
  const helpers = new Function(src.slice(start, end) + '\n return { fmtLocalHM: fmtLocalHM, fmtLocalStamp: fmtLocalStamp }')()
  const iso = '2026-10-16T10:00:00.000Z'
  const d = new Date(iso)
  const expect = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  assert.equal(helpers.fmtLocalHM(iso), expect, '必须等于本地时刻')
  if (d.getTimezoneOffset() !== 0) {
    assert.notEqual(helpers.fmtLocalHM(iso), '10:00', '非 UTC 时区下不许显示 UTC 的 10:00')
  }
  assert.equal(helpers.fmtLocalHM(''), '', '空值 ⇒ 空串（不是 Invalid Date）')
  assert.equal(helpers.fmtLocalHM(null), '')
  assert.equal(helpers.fmtLocalHM('garbage'), '')
  assert.match(helpers.fmtLocalStamp(iso), /^\d{2}-\d{2} \d{2}:\d{2}$/, '本地时间戳格式 MM-DD HH:MM')
  assert.equal(helpers.fmtLocalHM(new Date(iso)), helpers.fmtLocalHM(iso), '传 Date 也要能用')
})
