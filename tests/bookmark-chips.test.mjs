import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readClientSource } from './_client-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/**
 * ★ 书签卡片「站方指标 chip」的永久回归测试（2026-10-16 使用反馈）。
 *
 * 两个真实症状：
 *   ① 番茄书签显示**两个在读** —— metric 与 collect 同源（都是 row.value），各画一个 chip；
 *   ② 其余站点显示**「名次 —」** —— 名次型榜 row.value 恒为 null，host 仍写 metric={名次,null}，
 *      客户端对 null 回退 '—'（spec-书签-v1:120 的卡片字段清单本来就没有名次 chip）。
 *
 * 与 tests/client-load.test.mjs 同一条纪律：**真加载** client/parts/*.js（宿主同形
 * window.__ModuleLoader__ + 真跑 factory），直接调模块自己导出的纯函数，而不是在测试里
 * 复刻一份判断逻辑（复刻等于没测）。
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function load() {
  const fakeReact = {
    Component: function Component(props) { this.props = props || {} },
    createElement: function () { return { t: arguments[0], p: arguments[1] || {} } },
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
  assert.ok(reg && typeof reg.factory === 'function', 'client.js 没有通过 __ModuleLoader__ 登记工厂')
  return reg.factory(function (spec) {
    if (spec === 'react') return fakeReact
    throw new Error('client bundle 加载期 require 了未声明的模块：' + spec)
  })
}

test('★ 书签 chip：模块真加载并导出 chip 纯函数', () => {
  const mod = load()
  assert.equal(mod.name, 'dsh-rank-scan')
  assert.equal(typeof mod.apply, 'function', 'apply 必须在（宿主靠它挂面板）')
  assert.equal(typeof mod.__test.metricChipText, 'function')
})

test('★ 书签 chip：名次型榜没有数值 ⇒ 不再渲染「名次 —」（起点/刺猬猫/菠萝包的真实形态）', () => {
  const metricChipText = load().__test.metricChipText
  assert.equal(metricChipText({ name: '名次', value: null }, 131219), null)
  assert.equal(metricChipText({ name: '名次', value: null }, 5835), null)
  assert.equal(metricChipText({ name: '名次', value: null }, null), null)
  assert.equal(metricChipText(null, 8656), null, '手动添加的书没有 metric')
})

test('★ 书签 chip：番茄 metric 与 collect 同源 ⇒ 不再显示两个在读', () => {
  const metricChipText = load().__test.metricChipText
  assert.equal(metricChipText({ name: '在读', value: 652278 }, 652278), null, '同源同值只画一个 chip')
  assert.equal(metricChipText({ name: '在读', value: 652278 }, null), '在读 652278', '没有 collect 时仍要显示')
  assert.equal(metricChipText({ name: '在读', value: 100 }, 200), '在读 100', '不同值各显示一条')
  /**
   * ★ 2026-10-17（使用者反馈「又出现两个在读」）：同口径、但数值不同（collect 是最新、metric 是上次记录）
   *   时，卡片不再另画一个同名 chip，而是由调用方渲染成「书签记录 X」。传了口径就走这条：
   */
  assert.equal(metricChipText({ name: '在读', value: 100 }, 200, '在读'), null, '同口径不再并排画两个「在读」')
  assert.equal(metricChipText({ name: '在读', value: 100 }, 200, '收藏'), '在读 100', '不同口径（如「在读 vs 收藏」）仍要显示')
})

test('★ 书签 chip：卡片渲染必须走这个函数（防止测的是另一份复刻实现）', () => {
  const src = readClientSource()
  assert.match(src, /metricChipText\(b\.metric, b\.collect, lab\)/, '卡片渲染要调用 metricChipText，不许再写一份内联判断')
  assert.match(src, /书签记录 /, '同口径的旧值要用「书签记录 X」标出来，别跟实时值共用一个标签')
})
