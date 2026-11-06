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

test('0 个榜：不渲染全部榜单表头，变化区给去设置按钮', () => {
  assert.match(overviewSrc, /showAll && total > 0 \? h\('table'/)
  assert.ok(overviewSrc.includes('还没有勾选要扫的榜'))
  assert.ok(overviewSrc.includes('去设置勾选'))
})
