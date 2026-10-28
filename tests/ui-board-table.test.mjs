import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readClientSource } from './_client-source.mjs'
import vm from 'node:vm'

const s = readClientSource()

function loadBoardTable() {
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
  reg.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require: ' + name) })
  return sandbox.window.__rankScanBoardTableTest
}

test('sortableCols 默认列 + host sortOptions 列都可点，默认列方向由宿主默认项决定', () => {
  const fn = loadBoardTable()
  const cols = [{ key: 'rank', label: '名次' }, { key: 'title', label: '书名' }, { key: 'read', label: '在读' }]
  const got = fn.sortableCols(cols, [{ value: '', label: '默认（名次）' }, { value: 'read', label: '在读' }], 'rank', 'ascending')
  assert.deepEqual(got.map((x) => x.key), ['rank', 'read'])
  assert.equal(got[0].dir, 'ascending')
  assert.equal(got[1].dir, 'descending')
  const derived = fn.sortableCols([{ key: 'value' }, { key: 'read' }], [{ value: '', label: '默认（今日涨幅）' }, { value: 'value', label: '今日涨幅' }], 'value', 'descending')
  assert.deepEqual(derived.map((x) => x.key), ['value'])
  assert.equal(derived[0].dir, 'descending')
  const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(host, /const wantedSort = sort === 'rank' \? undefined : sort/, 'sort=rank 必须视同未指定')
  assert.match(host, /const effSort = wantedSort \|\| defaultSortFor\(boardId\)[\s\S]{0,200}compareDesc/, '宿主 effSort 必须继续使用 compareDesc')
})

test('nextSort 覆盖默认列、派生榜 value 重叠与旧偏好归一', () => {
  const fn = loadBoardTable()
  assert.equal(fn.nextSort('', 'read', 'rank'), 'read')
  assert.equal(fn.nextSort('read', 'read', 'rank'), '')
  assert.equal(fn.nextSort('', 'rank', 'rank'), '')
  assert.equal(fn.nextSort('periodDelta', 'rank', 'rank'), '')
  assert.equal(fn.nextSort('', 'value', 'value'), '')
  assert.equal(fn.nextSort('read', 'value', 'value'), '')
  assert.equal(fn.normalizeSortPref('rank'), '')
  assert.equal(fn.normalizeSortPref('read'), 'read')
  assert.equal(fn.normalizeSortPref(null), '')
})

test('nextRowIdx 覆盖上下/Home/End 与边界', () => {
  const fn = loadBoardTable()
  assert.equal(fn.nextRowIdx(2, 'ArrowDown', 5), 3)
  assert.equal(fn.nextRowIdx(2, 'ArrowUp', 5), 1)
  assert.equal(fn.nextRowIdx(4, 'ArrowDown', 5), 4)
  assert.equal(fn.nextRowIdx(0, 'ArrowUp', 5), 0)
  assert.equal(fn.nextRowIdx(3, 'Home', 5), 0)
  assert.equal(fn.nextRowIdx(1, 'End', 5), 4)
  assert.equal(fn.nextRowIdx(1, 'Enter', 5), null)
})

test('表头 aria-sort、行/卡片 aria-expanded、列说明折叠与复制 Promise 分支都在源码里', () => {
  assert.match(s, /'aria-sort': active \? shownDir : undefined/)
  assert.match(s, /const pickSort = function \(v\) \{\n\s*if \(v === ss\) return/, '默认态再点默认列不能留下滚动标记')
  assert.match(s, /'aria-expanded': open \? 'true' : 'false'/)
  assert.match(s, /h\('details'/)
  assert.match(s, /'列说明'/)
  assert.match(s, /writeText\([^)]*\)\.then/)
})
