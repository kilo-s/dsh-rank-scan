import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 编译产物解析顺序：显式 RANK_SCAN_TEST_LIB → lib/（正常构建）→ .tmp-usability/lib（本地临时编译）。
// 三者都没有时**跳过**并说明原因：本包只改 src，不允许替使用者重建 lib/；
// 一旦构建过（CI 的 prepare / 本地 npm run build）这里就会真实执行断言。
const envLib = process.env.RANK_SCAN_TEST_LIB
const candidates = [
  envLib ? pathToFileURL(envLib.replace(/\\/g, '/') + '/').href : null,
  new URL('../lib/', import.meta.url).href,
  new URL('../.tmp-usability/lib/', import.meta.url).href,
].filter(Boolean)
const base = candidates.find((c) => existsSync(join(fileURLToPath(c), 'scan', 'daily.js')))
if (!base) {
  console.log('SKIP usability-data-*：找不到编译产物（先 npm run build，或设置 RANK_SCAN_TEST_LIB 指向临时编译目录）')
  process.exit(0)
}
const load = (p) => import(new URL(p, base).href)


const { runScan } = await load('scan/run.js')
const { MemoryStore, FileStore } = await load('scan/store.js')
const { MissingError } = await load('scan/types.js')
const daily = await load('scan/daily.js')
const files = await load('scan/files.js')

const at = (iso) => ({ now: () => new Date(iso) })
const row = (n) => ({ key: 'k' + n, rank: n, value: null, title: 'T' + n, author: null, url: null })
const okBoard = (b, n = 1) => ({ boardId: b, status: 'ok', rows: Array.from({ length: n }, (_, i) => row(i + 1)), requests: 1, durationMs: 1, warnings: [] })
const site = (id, boards, fn) => ({ id, site: id, metric: 'rank', boards, fetchBoard: fn })

test('自动重试不把进度算超：2 个榜各重试一次 ⇒ done/total = 2/2，attempts=4', async () => {
  const store = new MemoryStore()
  const tries = new Map()
  const s = site('s', ['a', 'b'], async (b) => {
    tries.set(b, (tries.get(b) || 0) + 1)
    if (tries.get(b) === 1) throw new MissingError('fetch failed')
    return okBoard(b)
  })
  const rec = await runScan({ sites: [s], clock: at('2026-10-22T00:30:00+08:00'), store, retryDelayMs: 0, maxRetryPerBoard: 2 })
  assert.equal(rec.progress.total, 2)
  assert.equal(rec.progress.done, 2, 'done 必须按**不同榜**计，不能把重试再算一次（旧实现会出 3/2）')
  assert.ok(rec.progress.done <= rec.progress.total)
  assert.equal(rec.progress.attempts, 4, '首轮 2 + 重试 2 = 4 次尝试（只作诊断）')
})

test('批次元信息写进记录：按站扫描只声明本批的榜', async () => {
  const store = new MemoryStore()
  const s = site('sfacg', ['sfacg.vip.week'], async (b) => okBoard(b, 1))
  const rec = await runScan({
    sites: [s], clock: at('2026-10-22T09:30:00+08:00'), store,
    boards: ['sfacg.vip.week'], partial: true, batchSite: 'sfacg', retryDelayMs: 0,
  })
  assert.deepEqual(rec.batch, { site: 'sfacg', partial: true, boards: ['sfacg.vip.week'] })
})

test('FileStore：被拒快照保留 raw、标记可读可清；逐榜基准跨过缺日', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-usability-'))
  try {
    const st = new FileStore(root)
    await st.writeSnapshot({ boardId: 'qidiantu.sanjiang', dataDate: '2026-10-17', metric: 'value', rows: [row(1), row(2)] })
    await st.writeSnapshot({ boardId: 'qidiantu.sanjiang', dataDate: '2026-10-19', metric: 'value', rows: [row(3)] })
    // 10-18 故意缺失
    const dates = files.listDataDates(root)
    assert.deepEqual(dates, ['2026-10-17', '2026-10-19'])
    const prev = daily.previousTrustedDate(dates, '2026-10-19', (d) => st.readSnapshot(d, 'qidiantu.sanjiang'), (d) => st.isUntrusted(d, 'qidiantu.sanjiang'))
    assert.equal(prev, '2026-10-17', '缺一天不能被当成「第一次采集」')

    st.markUntrusted('2026-10-19', 'qidiantu.sanjiang', { reason: '疑似未刷新', at: '2026-10-19T04:40:00.000Z', by: 'timer' })
    assert.equal(st.isUntrusted('2026-10-19', 'qidiantu.sanjiang'), true)
    assert.ok(existsSync(join(root, '2026-10-19', 'qidiantu.sanjiang.json')), 'raw 快照必须保留（证据）')
    // 若更早那天也被判不可信 ⇒ 没有可信基准（不能用被拒快照当基准）
    st.markUntrusted('2026-10-17', 'qidiantu.sanjiang', { reason: '疑似换榜', at: '2026-10-17T04:40:00.000Z', by: 'timer' })
    const prev2 = daily.previousTrustedDate(dates, '2026-10-19', (d) => st.readSnapshot(d, 'qidiantu.sanjiang'), (d) => st.isUntrusted(d, 'qidiantu.sanjiang'))
    assert.equal(prev2, null, '所有更早的可信快照都被拒 ⇒ 没有基准（不猜）')
    st.clearUntrusted('2026-10-17', 'qidiantu.sanjiang')
    st.clearUntrusted('2026-10-19', 'qidiantu.sanjiang')
    assert.equal(st.isUntrusted('2026-10-19', 'qidiantu.sanjiang'), false)
    assert.equal(st.isUntrusted('2026-10-17', 'qidiantu.sanjiang'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('FileStore：day-index 与 scan.json 分开，部分合并保留其它榜', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-usability-'))
  try {
    const st = new FileStore(root)
    const first = daily.mergeDayIndex(null, '2026-10-22', [
      { boardId: 'qidian.sign.cat12', status: 'ok', rows: 20, trusted: true, at: '2026-10-22T01:30:10.000Z', by: 'timer' },
      { boardId: 'qidian.sign.cat4', status: 'missing', reason: 'fetch failed', rows: 0, trusted: true, at: '2026-10-22T01:30:11.000Z', by: 'timer' },
    ], '2026-10-22T01:30:12.000Z')
    await st.writeDayIndex(first)
    await st.writeScan({ dataDate: '2026-10-22', startedAt: '2026-10-22T01:30:00.000Z', finishedAt: '2026-10-22T01:30:12.000Z', trigger: 'timer', attempt: 1, outcome: 'completed', progress: { done: 2, total: 2, attempts: 2 }, heartbeatAt: '2026-10-22T01:30:12.000Z', budget: { maxRequests: 600, maxDurationMs: 1, requestTimeoutMs: 1, boardTimeoutMs: 1, noProgressMs: 1, enrichTimeoutMs: 1 }, boards: [], warnings: [], batch: { site: 'qidian', partial: true, boards: ['qidian.sign.cat12', 'qidian.sign.cat4'] } })

    const second = daily.mergeDayIndex(st.readDayIndex('2026-10-22'), '2026-10-22', [
      { boardId: 'qidiantu.shouding', status: 'ok', rows: 113, trusted: true, at: '2026-10-22T04:40:05.000Z', by: 'timer' },
    ], '2026-10-22T04:40:06.000Z')
    await st.writeDayIndex(second)
    const day = st.readDayIndex('2026-10-22')
    assert.equal(day.boards['qidian.sign.cat4'].status, 'missing', '后一批不覆盖前一批的失败')
    assert.equal(day.boards['qidian.sign.cat4'].reason, 'fetch failed')
    assert.equal(day.boards['qidiantu.shouding'].status, 'ok')
    assert.ok(day.revision >= 2)
    // scan.json 仍是批次记录（只含本批）
    const rec = await st.readScan('2026-10-22')
    assert.equal(rec.batch.site, 'qidian')
    assert.equal(rec.boards.length, 0, '批次记录里的 boards 由扫描器写；这里验证两者是两份文件')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('FileStore：slim 按日合并 + 被拒榜剔除；revision 随快照改写变化', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-usability-'))
  try {
    const st = new FileStore(root)
    await st.writeSnapshot({ boardId: 'a', dataDate: '2026-10-22', metric: 'rank', rows: [row(1)] })
    await st.writeSnapshot({ boardId: 'b', dataDate: '2026-10-22', metric: 'rank', rows: [row(2)] })
    const incoming = { a: [{ key: 'k1', rank: 1, metric: null }] }
    const merged = daily.mergeSlimBoards(files.readSlim(root, '2026-10-22'), '2026-10-22', incoming)
    files.writeSlim(root, merged)
    const slim1 = files.readSlim(root, '2026-10-22')
    assert.deepEqual(Object.keys(slim1.boards), ['a'])

    const before = daily.revisionDigest(0, st.snapshotStats('2026-10-22'), st.untrustedBoards('2026-10-22'))
    // 改写 b 的快照（模拟补全/重抓）
    await new Promise((r) => setTimeout(r, 10))
    await st.writeSnapshot({ boardId: 'b', dataDate: '2026-10-22', metric: 'rank', rows: [row(2), row(3)] })
    const after = daily.revisionDigest(0, st.snapshotStats('2026-10-22'), st.untrustedBoards('2026-10-22'))
    assert.notEqual(before, after, '同一数据日期内数据变了 ⇒ revision 必变（前端据此重取）')

    st.markUntrusted('2026-10-22', 'b', { reason: 'x', at: '2026-10-22T05:00:00.000Z', by: 'timer' })
    const iso = daily.revisionDigest(0, st.snapshotStats('2026-10-22'), st.untrustedBoards('2026-10-22'))
    assert.notEqual(after, iso, '隔离状态变化也要反映到 revision')
    assert.ok(existsSync(join(root, '2026-10-22', 'b.untrusted.json')), '隔离标记与 raw 快照并存')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('真实运行数据的隔离副本：三江 10-18 缺日 ⇒ 10-19 基准是 10-17；被拒日不作为基准', async () => {
  const realRoot = process.env.RANK_SCAN_REAL_ROOT || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'data', 'rank-scan')
  if (!existsSync(join(realRoot, '2026-10-17')) || !existsSync(join(realRoot, '2026-10-19'))) {
    // 没有真实数据的环境（CI / 干净机器）跳过；测试本身不联网、不写真实目录
    return
  }
  const { cpSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-real-'))
  try {
    for (const d of ['2026-10-17', '2026-10-19']) {
      cpSync(join(realRoot, d), join(root, d), { recursive: true })
    }
    const st = new FileStore(root)
    const dates = files.listDataDates(root)
    assert.deepEqual(dates, ['2026-10-17', '2026-10-19'])
    const prev = daily.previousTrustedDate(dates, '2026-10-19', (d) => st.readSnapshot(d, 'qidiantu.sanjiang'), (d) => st.isUntrusted(d, 'qidiantu.sanjiang'))
    assert.equal(prev, '2026-10-17', '真实数据：10-18 缺失时基准必须是 10-17（而不是判「第一次采集」）')
    // 真实快照里三江的期键就是期首日：10-17 与 10-19 跨期 ⇒ 变化不可比
    const a = st.readSnapshot('2026-10-17', 'qidiantu.sanjiang')
    const b = st.readSnapshot('2026-10-19', 'qidiantu.sanjiang')
    const fresh = await load('scan/freshness.js')
    const ka = fresh.periodKeyFromRows(a.rows)
    const kb = fresh.periodKeyFromRows(b.rows)
    assert.ok(ka && kb && ka !== kb, '真实快照期键应不同（跨期）：' + ka + ' vs ' + kb)
    // 被拒日后不参与基准
    st.markUntrusted('2026-10-17', 'qidiantu.sanjiang', { reason: 'test', at: '2026-10-17T04:00:00.000Z', by: 'timer' })
    const prev2 = daily.previousTrustedDate(dates, '2026-10-19', (d) => st.readSnapshot(d, 'qidiantu.sanjiang'), (d) => st.isUntrusted(d, 'qidiantu.sanjiang'))
    assert.equal(prev2, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})