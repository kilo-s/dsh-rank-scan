import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * 0.5.0 概览信息结构守门：
 *   · 四张数字卡在主动作之前；待处理在补全 Banner 之前
 *   · StatCard 恰好 4 处调用；有 onClick 时是 button
 *   · 网格 auto-fit + minmax；空态文案；无变化不渲染分组筛选
 *   · 小尾巴 A：单榜扫描置位 Panel 忙态，409 走 warn；B：输入用 C.input
 */
const s = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
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
  vm.runInContext(s, sandbox, { filename: 'client/client.js' })
  return reg.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require: ' + name) })
}

test('概览顺序：四卡在主动作前，待处理在补全 Banner 前', () => {
  const cardsAt = overviewSrc.indexOf('/* ② 四张数字卡')
  const scanAt = overviewSrc.indexOf('/* ③ 主动作')
  assert.ok(cardsAt > 0 && scanAt > cardsAt, '数字卡必须在主动作（扫描已选榜）之前')
  const issuesAt = overviewSrc.indexOf('/* ④ 需要处理')
  const enrichAt = overviewSrc.indexOf('/* ⑤ 补全进度')
  assert.ok(issuesAt > 0 && enrichAt > issuesAt, '「需要处理」必须在补全 Banner 之前')
})

test('StatCard 恰好 4 处调用；有 onClick 渲染 button，没有渲染 div', () => {
  const calls = overviewSrc.match(/h\(StatCard/g) || []
  assert.equal(calls.length, 4, '概览必须恰好四张卡')
  const mod = loadComponents()
  const withClick = mod.__test.components.StatCard({ label: 'x', value: '1', onClick() {} })
  assert.equal(withClick.type, 'button', '可点卡必须是 button（键盘可聚焦）')
  const plain = mod.__test.components.StatCard({ label: 'x', value: '1' })
  assert.equal(plain.type, 'div', '不可点卡是 div')
})

test('数字卡网格用 auto-fit + minmax，不写死列数', () => {
  assert.match(overviewSrc, /gridTemplateColumns: 'repeat\(auto-fit, minmax\(180px, 1fr\)\)'/)
})

test('空态文案存在；无变化时不渲染分组筛选', () => {
  assert.ok(overviewSrc.includes('今天还没有采集结果，到计划时刻会自动跑，也可以点「扫描已选榜」'))
  assert.ok(overviewSrc.includes('今天没有榜单变化'))
  assert.match(overviewSrc, /chgEntries\.length \? h\('div', \{ style: C\.row \}/, '分组筛选只能由 chgEntries 驱动')
})

test('小尾巴 A：单榜扫描置位 Panel 忙态，409 走 warn', () => {
  assert.match(s, /onScanStart: function \(\) \{ postInFlightRef\.current \+= 1; setScanActBusy\(true\) \}/)
  assert.match(s, /onScanEnd: function \(\).*postInFlightRef\.current/)
  assert.match(boardSrc, /toast\('warn', '已有扫描在进行，请等它跑完'\)/)
  assert.match(boardSrc, /e\.status === 409/)
})

test('小尾巴 B：上架日 / 条数输入用 C.input', () => {
  assert.ok(!boardSrc.includes("fontSize: '12px', padding: '2px 4px'"), '不许再写死 12px/padding')
  assert.ok(boardSrc.includes("style: { ...C.input, width: '58px' }"))
  assert.ok(boardSrc.includes("style: { ...C.input, width: 'auto' }"))
})
