import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { applyCleanup, buildSlim, dirSize, exportRange, historyFor, listDataDates, planCleanup, readSlim, runRetention, writeReport, writeSlim } from '../lib/scan/files.js'

function tmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rank-files-'))
  for (const d of ['2026-10-01', '2026-10-06', '2026-10-07', '2026-10-13', '2026-10-14']) {
    mkdirSync(join(root, d), { recursive: true })
    writeFileSync(join(root, d, 'board.json'), 'x'.repeat(100))
  }
  return root
}

test('listDataDates / planCleanup：只挑超出保留档的日期', () => {
  const root = tmpRoot()
  const dates = listDataDates(root)
  assert.deepEqual(dates, ['2026-10-01', '2026-10-06', '2026-10-07', '2026-10-13', '2026-10-14'])
  assert.deepEqual(planCleanup(dates, '2026-10-14', 7), ['2026-10-01', '2026-10-06'])
  assert.deepEqual(planCleanup(dates, '2026-10-14', 'forever'), [])
})

test('applyCleanup：删除并给出释放字节数', () => {
  const root = tmpRoot()
  const freed = applyCleanup(root, ['2026-10-01'])
  assert.ok(freed >= 100)
  assert.equal(existsSync(join(root, '2026-10-01')), false)
  assert.deepEqual(listDataDates(root), ['2026-10-06', '2026-10-07', '2026-10-13', '2026-10-14'])
})

test('exportRange：按区间导出快照与报告（含嵌套子目录，逐文件递归复制）', () => {
  const root = tmpRoot()
  // 嵌套子目录：本机 fs.cpSync({recursive:true}) 曾在此形态下报 EIO，导出必须逐文件复制
  mkdirSync(join(root, '2026-10-14', 'nested'), { recursive: true })
  writeFileSync(join(root, '2026-10-14', 'nested', 'deep.json'), '{"deep":true}')
  writeReport(root, '2026-10-13', '# 报告')
  writeReport(root, '2026-09-01', '# 老报告')
  const dest = mkdtempSync(join(tmpdir(), 'rank-export-'))
  const out = exportRange(root, '2026-10-13', '2026-10-14', dest)
  assert.ok(out.includes('2026-10-13/board.json'))
  assert.ok(out.includes('2026-10-14/board.json'))
  assert.ok(out.includes('reports/2026-10-13.md'))
  assert.ok(!out.some((f) => f.includes('2026-10-01')))
  assert.ok(!out.some((f) => f.includes('2026-09-01')), '区间外的报告不导出')
  assert.deepEqual(readdirSync(join(dest, '2026-10-13')), ['board.json'])
  assert.deepEqual(readdirSync(join(dest, '2026-10-14')).sort(), ['board.json', 'nested'])
  assert.deepEqual(readdirSync(join(dest, '2026-10-14', 'nested')), ['deep.json'])
})

test('★ runRetention（ticket 22 的接线）：按保留档删数据日期目录，绝不动 state/', () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-scan-ret-'))
  // 造 5 个数据日期 + state/（含书签与配置——它们必须活下来）
  for (const d of ['2026-03-01', '2026-06-01', '2026-09-01', '2026-10-14', '2026-10-15']) {
    mkdirSync(join(root, d), { recursive: true })
    writeFileSync(join(root, d, 'qidian.sign.cat12.json'), JSON.stringify({ rows: Array.from({ length: 50 }, (_, i) => ({ key: i })) }), 'utf8')
    writeFileSync(join(root, d, 'report.html'), '<html></html>', 'utf8')
  }
  mkdirSync(join(root, 'state'), { recursive: true })
  writeFileSync(join(root, 'state', 'bookmarks.json'), JSON.stringify({ bookmarksVersion: 1, bookmarks: [{ bookKey: 'qidian:1' }] }), 'utf8')
  writeFileSync(join(root, 'state', 'config.json'), '{"boards":[]}', 'utf8')
  writeFileSync(join(root, 'state', 'qidian-book-cache.json'), '{}', 'utf8')

  // 180 天档，今天 2026-10-15 ⇒ 只应删 2026-03-01（距今 228 天）
  const r = runRetention(root, '2026-10-15', 180)
  assert.deepEqual(r.removed, ['2026-03-01'], '只删过期的那个日期')
  assert.ok(r.freed > 0, '要报出释放字节数：' + r.freed)
  assert.equal(existsSync(join(root, '2026-03-01')), false, '过期目录被物理删除')
  for (const d of ['2026-06-01', '2026-09-01', '2026-10-14', '2026-10-15']) {
    assert.equal(existsSync(join(root, d)), true, d + ' 在保留档内，不许删')
  }
  // ★ 最关键的一条：state/ 必须完好（配置、书签、书页缓存都在这）
  assert.equal(existsSync(join(root, 'state', 'bookmarks.json')), true, '书签文件绝不能被保留策略删掉')
  assert.equal(existsSync(join(root, 'state', 'config.json')), true)
  assert.equal(existsSync(join(root, 'state', 'qidian-book-cache.json')), true)
  assert.equal(JSON.parse(readFileSync(join(root, 'state', 'bookmarks.json'), 'utf8')).bookmarks[0].bookKey, 'qidian:1', '内容也没被动过')

  // 'forever' ⇒ 一个都不删
  const rf = runRetention(root, '2026-10-15', 'forever')
  assert.deepEqual(rf.removed, [])
  assert.equal(existsSync(join(root, '2026-06-01')), true)

  // 幂等：再跑一次不会重复报同一个日期，也不会报错
  const r2 = runRetention(root, '2026-10-15', 180)
  assert.deepEqual(r2.removed, [])
  assert.equal(existsSync(join(root, 'state', 'bookmarks.json')), true)
})

test('精简索引：抽出最小字段 / 落盘可回读 / 体积远小于快照', () => {
  const root = tmpRoot()
  const record = {
    dataDate: '2026-10-14', boards: [
      { boardId: 'qidian.sign.cat12', status: 'ok', rows: [row('k1', 1), row('k2', 2)], requests: 1, durationMs: 1, warnings: [] },
      { boardId: 'qidian.sign.cat21', status: 'missing', rows: [], requests: 1, durationMs: 1, warnings: [] },
    ],
  }
  const slim = buildSlim(record, new Map())
  assert.deepEqual(Object.keys(slim.boards), ['qidian.sign.cat12'], 'missing 的榜不进精简索引')
  assert.deepEqual(slim.boards['qidian.sign.cat12'][0], { key: 'k1', rank: 1, metric: null })
  writeSlim(root, slim)
  assert.deepEqual(readSlim(root, '2026-10-14'), slim)
  assert.ok(dirSize(join(root, 'slim')) < 500)
})

test('historyFor：按榜汇总历史（不含当天）', () => {
  const indexes = [
    { dataDate: '2026-10-12', boards: { b: [{ key: 'k1', rank: 1, metric: null }] } },
    { dataDate: '2026-10-13', boards: { b: [{ key: 'k1', rank: 2, metric: null }, { key: 'k2', rank: 1, metric: null }] } },
    { dataDate: '2026-10-14', boards: { b: [{ key: 'k3', rank: 1, metric: null }] } },
  ]
  const h = historyFor(indexes, 'b', '2026-10-14')
  assert.deepEqual(h.get('k1').dates.sort(), ['2026-10-12', '2026-10-13'])
  assert.equal(h.get('k2').lastDate, '2026-10-13')
  assert.equal(h.has('k3'), false, '当天的索引不算历史')
})

function row(key, rank) {
  return { key, rank, value: null, title: 'T' + key, author: 'A', url: 'https://x/' + key }
}

test('normalizeRetention：7–3650 整数或永久，其余非法（2026-10-16 面板可选保留天数）', async () => {
  const { normalizeRetention } = await import('../lib/scan/files.js')
  assert.equal(normalizeRetention(180), 180)
  assert.equal(normalizeRetention('90'), 90)
  assert.equal(normalizeRetention(7), 7)
  assert.equal(normalizeRetention(3650), 3650)
  assert.equal(normalizeRetention('forever'), 'forever')
  assert.equal(normalizeRetention(' 永久 '), 'forever')
  assert.equal(normalizeRetention(6), null, '小于 7 天会把正在看的快照删掉')
  assert.equal(normalizeRetention(3651), null)
  assert.equal(normalizeRetention('abc'), null)
  assert.equal(normalizeRetention(null), null)
  assert.equal(normalizeRetention(undefined), null)
  assert.equal(normalizeRetention(true), null)
})
