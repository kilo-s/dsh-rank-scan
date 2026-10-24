/**
 * Spec E（2026-10-24）真实扫描进度闭环的离线验收。
 *
 * 口径：进度必须是**宿主内存里的真实记录**——
 *   ① runScan 从 0/N 就开始通知，逐榜推进，终态通知 completed；
 *   ② /scan 在跑的时候，/overview 能读到 running + inFlight + done/total（真实站点适配器，不伪造 onProgress）；
 *   ③ 跑完/失败后不留假 running（inFlight=false），面板不会一直显示扫描中；
 *   ④ 面板：定时扫描（busy=false）也显示进度与取消；旧进程留下的 running 不冒充在跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { apply } from '../lib/index.js'
import { runScan } from '../lib/scan/run.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const BOARDS = ['qidian.sign.cat12', 'qidian.sign.cat21']

function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('超时：' + label)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

function rowFor(boardId) {
  return { key: 'qidian:' + boardId, rank: 1, title: '进度夹具', author: '作者', url: 'https://example.invalid/b', extra: {} }
}

/* ---------- ① runScan：从 0/N 开始通知 ---------- */
test('runScan 从 0/N 就开始通知，逐榜推进，并以 completed 收尾', async () => {
  const seen = []
  const store = {
    async getCancelFlag() { return false },
    async setCancelFlag() {},
    async writeSnapshot() {},
    async writeScan() {},
    async acquireLock() { return { ok: true, previous: null } },
    async heartbeatLock() {},
    async releaseLock() {},
  }
  const site = {
    id: 'qidian', site: 'qidian', metric: 'rank', boards: BOARDS,
    async fetchBoard(boardId) {
      return { boardId, status: 'ok', rows: [rowFor(boardId)], requests: 1, durationMs: 1, warnings: [] }
    },
  }
  const rec = await runScan({
    sites: [site],
    clock: { now: () => new Date('2026-10-24T02:00:00Z') },
    store,
    onProgress: (r) => seen.push({ outcome: r.outcome, done: r.progress.done, total: r.progress.total }),
  })

  assert.ok(seen.length >= 3, '起始 + 每榜 + 终态都要通知，实际 ' + seen.length + ' 次')
  assert.deepEqual(seen[0], { outcome: 'running', done: 0, total: 2 }, '第一次通知必须是 0/2（旧实现第一次已经是 1/N）')
  assert.deepEqual(seen[1], { outcome: 'running', done: 1, total: 2 })
  assert.deepEqual(seen[2], { outcome: 'running', done: 2, total: 2 })
  assert.equal(seen[seen.length - 1].outcome, 'completed', '终态要通知 completed，overview 才不会短暂回退成 running')
  assert.equal(rec.outcome, 'completed')
})

test('onProgress 抛错不许中断扫描（观察者是外部注入的）', async () => {
  const store = {
    async getCancelFlag() { return false },
    async setCancelFlag() {},
    async writeSnapshot() {},
    async writeScan() {},
    async acquireLock() { return { ok: true, previous: null } },
    async heartbeatLock() {},
    async releaseLock() {},
  }
  const site = {
    id: 'qidian', site: 'qidian', metric: 'rank', boards: BOARDS,
    async fetchBoard(boardId) { return { boardId, status: 'ok', rows: [rowFor(boardId)], requests: 1, durationMs: 1, warnings: [] } },
  }
  const rec = await runScan({
    sites: [site],
    clock: { now: () => new Date('2026-10-24T02:00:00Z') },
    store,
    onProgress: () => { throw new Error('observer boom') },
  })
  assert.equal(rec.outcome, 'completed')
  assert.equal(rec.progress.done, 2)
})

/* ---------- ② /scan 与 /overview 的真实闭环 ---------- */
function harness() {
  const root = mkdtempSync(join(process.cwd(), '.tmp-spec-e-'))
  mkdirSync(join(root, 'state'))
  writeFileSync(join(root, 'state/config.json'), JSON.stringify({
    boards: BOARDS, display: BOARDS, timerEnabled: false, timerSchemaV: 3, autoEnrich: false,
  }))

  let startedCount = 0
  const startWaiters = []
  const gates = []
  const site = {
    id: 'qidian', site: 'qidian', metric: 'rank', boards: BOARDS,
    async fetchBoard(boardId) {
      startedCount += 1
      const w = startWaiters.shift()
      if (w) w(startedCount)
      await new Promise((resolve) => gates.push(resolve))
      return { boardId, status: 'ok', rows: [rowFor(boardId)], requests: 1, durationMs: 1, warnings: [] }
    },
  }
  const waitStart = (n) => (startedCount >= n ? Promise.resolve() : new Promise((r) => startWaiters.push(r)))
  const releaseNext = () => { const g = gates.shift(); if (g) g() }

  let handler
  const disposers = []
  apply({
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    setInterval() { return { dispose() {} } },
    webServer: { register(route) { handler = route.handler; return () => {} } },
    logger: { info() {} },
  }, { dataDir: root, timerFreshMs: 0, sitesFactory: () => [site] })

  async function call(url, body) {
    const listeners = {}
    let code
    let raw = ''
    const req = {
      url,
      method: body === undefined ? 'GET' : 'POST',
      headers: { host: '127.0.0.1:19387', 'content-type': 'application/json' },
      setEncoding() {},
      on(k, f) { (listeners[k] || (listeners[k] = [])).push(f); return req },
    }
    const p = handler(req, { writeHead(c) { code = c }, setHeader() {}, end(v) { raw = String(v || '') } })
    queueMicrotask(() => {
      if (body !== undefined) for (const f of listeners.data || []) f(JSON.stringify(body))
      for (const f of listeners.end || []) f()
    })
    await p
    return { code, body: JSON.parse(raw) }
  }

  return {
    root, call, waitStart, releaseNext,
    cleanup() {
      for (const d of disposers) d()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test('扫描进行中 /overview 能读到真实进度（0/N → 1/N），结束后是 completed 且 inFlight=false', async () => {
  const h = harness()
  try {
    const scanning = h.call('/api/rank-scan/scan', {})
    await withTimeout(h.waitStart(1), 5000, '第一个榜开始')

    let ov = await h.call('/api/rank-scan/overview')
    assert.equal(ov.code, 200)
    assert.equal(ov.body.scan.outcome, 'running', '跑的时候 overview 必须是 running')
    assert.equal(ov.body.scan.inFlight, true, 'inFlight 表示这一轮真的在本进程里跑')
    assert.deepEqual(ov.body.scan.progress, { done: 0, total: 2, attempts: 0 }, '第一个榜还没跑完就是 0/2')

    h.releaseNext()
    await withTimeout(h.waitStart(2), 5000, '第二个榜开始')
    ov = await h.call('/api/rank-scan/overview')
    assert.equal(ov.body.scan.outcome, 'running')
    assert.equal(ov.body.scan.progress.done, 1, '完成一个榜就该是 1/2')
    assert.equal(ov.body.scan.progress.total, 2)

    h.releaseNext()
    const done = await withTimeout(scanning, 10000, '扫描结束')
    assert.equal(done.code, 200)
    assert.equal(done.body.outcome, 'completed')

    ov = await h.call('/api/rank-scan/overview')
    assert.equal(ov.body.scan.outcome, 'completed', '结束后不许还是 running')
    assert.equal(ov.body.scan.inFlight, false, '结束必须清掉活跃记录')
    assert.equal(ov.body.scan.progress.done, 2)
  } finally {
    h.cleanup()
  }
})

test('扫描抛错/全部失败后也不留假 running（面板不会一直显示扫描中）', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-spec-e-fail-'))
  mkdirSync(join(root, 'state'))
  writeFileSync(join(root, 'state/config.json'), JSON.stringify({
    boards: BOARDS, display: BOARDS, timerEnabled: false, timerSchemaV: 3, autoEnrich: false,
  }))
  const site = {
    id: 'qidian', site: 'qidian', metric: 'rank', boards: BOARDS,
    async fetchBoard() { throw new Error('network down') },
  }
  let handler
  apply({
    effect(fn) { const d = fn(); if (typeof d === 'function') d() },
    setInterval() { return { dispose() {} } },
    webServer: { register(route) { handler = route.handler; return () => {} } },
    logger: { info() {} },
  }, { dataDir: root, timerFreshMs: 0, sitesFactory: () => [site] })

  async function call(url, body) {
    const listeners = {}
    let code
    let raw = ''
    const req = {
      url, method: body === undefined ? 'GET' : 'POST',
      headers: { host: '127.0.0.1:19387', 'content-type': 'application/json' },
      setEncoding() {},
      on(k, f) { (listeners[k] || (listeners[k] = [])).push(f); return req },
    }
    const pending = handler(req, { writeHead(c) { code = c }, setHeader() {}, end(v) { raw = String(v || '') } })
    queueMicrotask(() => {
      if (body !== undefined) for (const f of listeners.data || []) f(JSON.stringify(body))
      for (const f of listeners.end || []) f()
    })
    await pending
    return { code, body: JSON.parse(raw) }
  }

  try {
    const r = await call('/api/rank-scan/scan', {})
    assert.equal(r.code, 200)
    const ov = await call('/api/rank-scan/overview')
    assert.equal(ov.body.scan.inFlight, false, '失败收尾后活跃记录必须清空')
    assert.notEqual(ov.body.scan.outcome, 'running', '落盘记录不许停在 running')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/* ---------- ④ 面板：按真实运行态显示 ---------- */
function loadPanel() {
  const SOURCE = join(HERE, '..', 'client', 'client.js')
  const SRC = readFileSync(SOURCE, 'utf8')
  let registration = null
  const React = {
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
    Component: (function () {
      function Component(props) { this.props = props || {} }
      Component.prototype.setState = function () {}
      return Component
    })(),
    Fragment: 'Fragment',
  }
  const sandbox = {
    console, Promise, JSON, Math, Number, String, Object, Array, Date, RegExp, Error,
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    Event: function Event() {},
    localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null }, setItem(k, v) { this._m[k] = String(v) }, removeItem(k) { delete this._m[k] } },
    sessionStorage: { _m: {}, getItem(k) { return this._m[k] ?? null }, setItem(k, v) { this._m[k] = String(v) }, removeItem(k) { delete this._m[k] } },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { load(reg) { registration = reg } } },
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox)
  const mod = registration.factory(() => React)
  return { mod, src: SRC }
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  return (node.children || []).map(textOf).join(' ')
}

function expand(node, depth = 0) {
  if (node === null || node === undefined || node === false || depth > 10) return node
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map((n) => expand(n, depth + 1))
  if (typeof node.type === 'function') {
    // 面板里有 TabBoundary 这类 class 组件
    if (node.type.prototype && node.type.prototype.isReactComponent) {
      const inst = new node.type(node.props || {})
      return expand(inst.render(), depth + 1)
    }
    return expand(node.type(node.props || {}), depth + 1)
  }
  return { ...node, children: (node.children || []).map((n) => expand(n, depth + 1)) }
}

function ov(scan) {
  return {
    dataDate: '2026-10-24',
    dates: ['2026-10-23', '2026-10-24'],
    baselineDate: '2026-10-23',
    counts: { ok: 1, missing: 0, stale: 0, login_required: 0, truncated: 0 },
    hiddenCount: 0,
    sites: [{ site: 'qidian', siteName: '起点', boards: [
      { boardId: 'qidian.sign.cat12', name: '轻小说', status: 'ok', up: 1, newCount: 0, out: 0, lastCapture: '2026-10-24T01:30:00Z', note: null, derived: false, displayed: true },
    ] }],
    storage: { totalBytes: 1000, stateBytes: 100, snapshotBytes: 900, dates: 2, oldest: '2026-10-23', newest: '2026-10-24', retentionDays: 180, bookmarks: 0, cachedAt: '2026-10-24T01:31:00Z' },
    services: { webServer: true, timerService: true, timerArmed: true, schedule: { now: '15:00', today: '2026-10-24', staleFlag: {} } },
    scan,
  }
}

test('scanLabel 覆盖全部扫描终态，不把内部枚举漏到界面', () => {
  const { scanLabel } = loadPanel().mod.__test.helpers
  assert.match(scanLabel({ outcome: 'completed', trigger: 'timer' }), /定时 · 已完成/)
  assert.match(scanLabel({ outcome: 'cancelled', trigger: 'manual' }), /手动 · 已取消/)
  assert.match(scanLabel({ outcome: 'running', inFlight: true, trigger: 'timer' }), /定时 · 扫描中/)
  assert.match(scanLabel({ outcome: 'over_budget', trigger: 'timer' }), /预算/)
  assert.match(scanLabel({ outcome: 'aborted_stalled', trigger: 'timer' }), /没有进展/)
  assert.ok(!/over_budget|aborted_stalled/.test(scanLabel({ outcome: 'over_budget' })), '不许直接显示英文枚举')
  assert.match(scanLabel({ outcome: 'running', inFlight: false, trigger: 'timer' }), /未完成/, '进程退出留下的 running 不能冒充正在跑')
})

test('定时扫描（busy=false）也显示真实进度和取消入口', () => {
  const { mod } = loadPanel()
  const Overview = mod.__test.components.Overview
  const txt = textOf(expand(Overview({
    ov: ov({ outcome: 'running', inFlight: true, attempt: 1, trigger: 'timer', progress: { done: 3, total: 10 }, warnings: [] }),
    busy: false, act() {}, reload() {}, narrow: false, rev: 'r1',
  })))
  assert.match(txt, /扫描中 3\/10/, '定时扫描没有本地 busy，也必须显示进度')
  assert.match(txt, /停止本次/, '定时扫描也要能取消')
  assert.ok(!/扫描已选榜/.test(txt), '正在跑时主按钮不能还写「扫描已选榜」')
})

test('进程退出留下的 running（inFlight=false）不冒充在跑', () => {
  const { mod } = loadPanel()
  const Overview = mod.__test.components.Overview
  const txt = textOf(expand(Overview({
    ov: ov({ outcome: 'running', inFlight: false, attempt: 1, trigger: 'timer', progress: { done: 3, total: 10 }, warnings: [] }),
    busy: false, act() {}, reload() {}, narrow: false, rev: 'r1',
  })))
  assert.ok(!/扫描中/.test(txt), '没有活跃记录就不许显示扫描进度')
  assert.ok(!/停止本次/.test(txt), '也不许给一个点了没用的取消')
  assert.match(txt, /扫描已选榜/)
  assert.match(txt, /未完成/, '要把上次没跑完说清楚')
})

test('轮询节奏：空闲 20s、运行中 2s，且刚点完扫描（POST 未返回）也走 2s', () => {
  const { pollDelay } = loadPanel().mod.__test.helpers
  assert.equal(pollDelay(false, false), 20000, '空闲 20s')
  assert.equal(pollDelay(true, false), 2000, '真实在跑 2s')
  assert.equal(pollDelay(false, true), 2000, 'POST /scan 还没回、overview 仍是上一轮 completed 时也必须 2s')
  assert.equal(pollDelay(true, true), 2000)
})

test('刚点完扫描：按钮先说「扫描中…」而不是「处理中…」', () => {
  const { mod } = loadPanel()
  const Overview = mod.__test.components.Overview
  const txt = textOf(expand(Overview({
    ov: ov({ outcome: 'completed', inFlight: false, attempt: 1, trigger: 'timer', progress: { done: 10, total: 10 }, warnings: [] }),
    busy: true, scanStarting: true, act() {}, reload() {}, narrow: false, rev: 'r1',
  })))
  assert.match(txt, /扫描中…/, '发起扫描的等待期不能显示成普通「处理中」')
  assert.match(txt, /停止本次/, '等待期也要能取消')
})

test('扫描类请求不抢先用 setBusy(false) 解锁（取消/重试期间保持禁用）', () => {
  const { src } = loadPanel()
  assert.match(src, /const isScanAct = function \(path\)/, '扫描类操作要单独判忙态')
  assert.match(src, /if \(!scanLiveRef\.current && postInFlightRef\.current === 0\) setScanActBusy\(false\)/, '解锁必须等扫描真的停下')
  assert.ok(!/if \(!busy && document\.visibilityState/.test(src), '旧实现拿 busy 当闸门，定时扫描永远刷不到进度')
  assert.match(src, /reloadBusyRef/, '运行中 2s 轮询要有防重入闸，慢请求不能叠')
})
